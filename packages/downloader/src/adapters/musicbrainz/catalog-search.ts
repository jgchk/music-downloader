import { Result, ResultAsync, err, ok, okAsync } from 'neverthrow';
import { infraError, permanentInfraError } from '../../application/ports/errors.js';
import { fetchHttpClient } from '../support/http.js';
import {
  toArtists,
  toDiscography,
  toEditionListing,
  toRecordings,
  toReleaseGroups,
  toTracks,
} from './catalog-mapping.js';
import { leadingKind, rankArtists, rankRecordings, rankReleaseGroups } from './ranking.js';
import {
  mbArtistEntitySchema,
  mbArtistSearchSchema,
  mbCatalogRecordingEntitySchema,
  mbCatalogRecordingSearchSchema,
  mbReleaseGroupBrowseSchema,
  mbReleaseGroupEntitySchema,
  mbReleaseGroupSearchSchema,
  mbReleaseSchema,
} from './schemas.js';
import type { ZodType } from 'zod';
import type { InfraError } from '../../application/ports/errors.js';
import type { OperationScope } from '../../application/correlation/context.js';
import type { HttpClient, HttpRequest, HttpResponse } from '../support/http.js';
import type { Mbid } from '../../domain/shared/mbid.js';
import type {
  CatalogEditionListing,
  CatalogLookup,
  CatalogReleaseGroup,
  CatalogSearchPort,
  CatalogSearchResults,
  CatalogTrack,
} from '../../application/ports/catalog-search-port.js';

/**
 * The MusicBrainz adapter for the catalog-search port: the read a person searches with.
 *
 * Upstream stewardship is met by asking LESS rather than by queueing. A minimum-interval queue in
 * front of a user-facing search would serialize its three entity queries into multi-second waits,
 * so instead every request identifies this application, a search costs a fixed three upstream
 * reads however many results come back, and tracklists are never fetched for search hits — only
 * when a person opens one. Remembering an answer and sharing an in-flight read are the same
 * courtesy by other means, and belong to the client this adapter is given (`cachingHttpClient`),
 * not to the conversation it holds with MusicBrainz.
 *
 * Errors are values throughout: the vendor's throwing surfaces (`fetch`, `JSON.parse`) are
 * converted at the call site, schema validation uses zod's non-throwing `safeParse`, and drift is
 * marked permanent because retrying a changed provider shape cannot fix it.
 */

const DEFAULT_BASE_URL = 'https://musicbrainz.org/ws/2';
const DEFAULT_USER_AGENT = 'music-downloader/0.0 (https://github.com/anthropics/music-downloader)';
/** Per entity kind. Wide enough that ranking has real candidates to reorder, not a pre-cut list. */
const DEFAULT_SEARCH_LIMIT = 25;
/** The two 4xx statuses that mean "later", not "never". */
const TOO_MANY_REQUESTS = 429;
const REQUEST_TIMEOUT = 408;
/** MusicBrainz's browse ceiling, shared by the edition listing and the artist discography. */
const BROWSE_LIMIT = 100;

/** Named per entity, so a failure says WHICH of a search's three reads could not be made. */
const RELEASE_GROUP_SEARCH_OPERATION = 'musicbrainz.catalog.search.release-group';
const ARTIST_SEARCH_OPERATION = 'musicbrainz.catalog.search.artist';
const RECORDING_SEARCH_OPERATION = 'musicbrainz.catalog.search.recording';
const LOOKUP_OPERATION = 'musicbrainz.catalog.lookup';
const DISCOGRAPHY_OPERATION = 'musicbrainz.catalog.discography';
const EDITIONS_OPERATION = 'musicbrainz.catalog.editions';
const TRACKLIST_OPERATION = 'musicbrainz.catalog.tracklist';

export interface CatalogSearchConfig {
  readonly baseUrl?: string;
  readonly userAgent?: string;
  readonly searchLimit?: number;
}

/**
 * What a person typed, as literal words rather than query syntax. MusicBrainz parses `query=` as
 * Lucene, so an unbalanced quote or a stray `:` in a title — `Sgt. Pepper's`, `Album: Live` — is a
 * syntax error to it, answered 400. Escaping the metacharacters means a searcher's punctuation
 * searches for that punctuation instead of failing the read.
 */
export function luceneLiteral(query: string): string {
  return query.replaceAll(/[+\-&|!(){}[\]^"~*?:\\/]/g, (character) => `\\${character}`);
}

const parseJson = Result.fromThrowable(
  (body: string): unknown => JSON.parse(body),
  (cause) => cause,
);

/**
 * The client call as a value. `fromThrowable` rather than `fromPromise(client.send(…))`: the
 * latter evaluates the call as an ARGUMENT, so a client that throws before it returns a promise
 * throws past the wrapper meant to tame it — and this method promises a Result.
 */
const sendSafely = ResultAsync.fromThrowable(
  async (http: HttpClient, request: HttpRequest): Promise<HttpResponse> => await http.send(request),
  (cause) => cause,
);

export class MusicBrainzCatalogSearch implements CatalogSearchPort {
  private readonly baseUrl: string;
  private readonly userAgent: string;
  private readonly searchLimit: number;

  constructor(
    private readonly http: HttpClient = fetchHttpClient,
    config: CatalogSearchConfig = {},
  ) {
    this.baseUrl = config.baseUrl ?? DEFAULT_BASE_URL;
    this.userAgent = config.userAgent ?? DEFAULT_USER_AGENT;
    this.searchLimit = config.searchLimit ?? DEFAULT_SEARCH_LIMIT;
  }

  search(query: string, scope: OperationScope): ResultAsync<CatalogSearchResults, InfraError> {
    const trimmed = query.trim();
    // A blank query asks nothing, so it costs the catalog nothing.
    if (trimmed === '') {
      return okAsync({ releaseGroups: [], artists: [], recordings: [], leading: 'release-group' });
    }
    // Built with URLSearchParams rather than encodeURIComponent: the latter THROWS on a lone
    // surrogate, and a throw here would escape the Result this method promises. The former
    // replaces a malformed sequence instead, which is the right answer for a search box.
    const encoded = new URLSearchParams({ query: luceneLiteral(trimmed) }).toString();
    const limit = this.searchLimit;
    return ResultAsync.combine([
      this.get(
        `${this.baseUrl}/release-group?${encoded}&fmt=json&limit=${limit}`,
        mbReleaseGroupSearchSchema,
        RELEASE_GROUP_SEARCH_OPERATION,
      ),
      this.get(
        `${this.baseUrl}/artist?${encoded}&fmt=json&limit=${limit}`,
        mbArtistSearchSchema,
        ARTIST_SEARCH_OPERATION,
      ),
      this.get(
        `${this.baseUrl}/recording?${encoded}&inc=releases&fmt=json&limit=${limit}`,
        mbCatalogRecordingSearchSchema,
        RECORDING_SEARCH_OPERATION,
      ),
    ]).map(([groupsJson, artistsJson, recordingsJson]) => {
      const scored = {
        releaseGroups: rankReleaseGroups(trimmed, toReleaseGroups(groupsJson ?? {})),
        artists: rankArtists(trimmed, toArtists(artistsJson ?? {})),
        recordings: rankRecordings(trimmed, toRecordings(recordingsJson ?? {})),
      };
      // `score` is ranking's own currency — it decides the order and which kind leads — and is
      // dropped the moment those decisions are made, rather than riding along on values whose
      // type does not declare it.
      const leading = leadingKind(trimmed, scored);
      const releaseGroups = scored.releaseGroups.map(({ score: _score, ...group }) => group);
      const artists = scored.artists.map(({ score: _score, ...artist }) => artist);
      const recordings = scored.recordings.map(({ score: _score, ...recording }) => recording);
      const received = {
        releaseGroups: (groupsJson?.['release-groups'] ?? []).length,
        artists: (artistsJson?.artists ?? []).length,
        recordings: (recordingsJson?.recordings ?? []).length,
      };
      const presented = {
        releaseGroups: releaseGroups.length,
        artists: artists.length,
        recordings: recordings.length,
      };
      // "They answered 25 and we could present none of them" is drift, and it reaches a person as
      // "Nothing matched" — indistinguishable from a genuine no-match. So it is a WARN, not a
      // debug line: production runs at info, where a debug line is never written at all, and an
      // upstream rename that empties every search would otherwise show only as clean 200s.
      const emptied = (Object.keys(received) as (keyof typeof received)[]).filter(
        (kind) => received[kind] > 0 && presented[kind] === 0,
      );
      if (emptied.length > 0) {
        scope.logger.warn(
          { received, presented, emptied },
          'catalog answered with hits none of which could be presented',
        );
      } else {
        scope.logger.debug({ received, presented }, 'catalog search answered');
      }
      return { releaseGroups, artists, recordings, leading };
    });
  }

  /**
   * An identifier names exactly one thing, but not which KIND of thing — so the kinds are tried in
   * the order a person is most likely to have pasted, and an id that answers nowhere is a
   * `notFound` outcome rather than a fault.
   */
  lookup(mbid: Mbid, scope: OperationScope): ResultAsync<CatalogLookup, InfraError> {
    return this.get(
      `${this.baseUrl}/release-group/${mbid}?inc=artist-credits&fmt=json`,
      mbReleaseGroupEntitySchema,
      LOOKUP_OPERATION,
    ).andThen((group) => {
      const [releaseGroup] = toReleaseGroups({
        'release-groups': group === undefined ? [] : [group],
      });
      // The catalog answered with something we could not present. That is drift, not absence, and
      // the two are indistinguishable downstream — so it is said here, once, where both are known.
      if (group !== undefined && releaseGroup === undefined) {
        scope.logger.warn({ mbid }, 'catalog release group could not be presented');
      }
      if (releaseGroup !== undefined) {
        return okAsync<CatalogLookup>({
          kind: 'found',
          entity: { kind: 'release-group', releaseGroup },
        });
      }
      return this.lookupArtist(mbid, scope);
    });
  }

  private lookupArtist(mbid: Mbid, scope: OperationScope): ResultAsync<CatalogLookup, InfraError> {
    return this.get(
      `${this.baseUrl}/artist/${mbid}?fmt=json`,
      mbArtistEntitySchema,
      LOOKUP_OPERATION,
    ).andThen((found) => {
      const [artist] = toArtists({ artists: found === undefined ? [] : [found] });
      if (found !== undefined && artist === undefined) {
        scope.logger.warn({ mbid }, 'catalog artist could not be presented');
      }
      if (artist !== undefined)
        return okAsync<CatalogLookup>({ kind: 'found', entity: { kind: 'artist', artist } });
      return this.lookupRecording(mbid, scope);
    });
  }

  private lookupRecording(
    mbid: Mbid,
    scope: OperationScope,
  ): ResultAsync<CatalogLookup, InfraError> {
    return this.get(
      `${this.baseUrl}/recording/${mbid}?inc=artist-credits+releases&fmt=json`,
      mbCatalogRecordingEntitySchema,
      LOOKUP_OPERATION,
    ).map((found) => {
      const [recording] = toRecordings({ recordings: found === undefined ? [] : [found] });
      if (found !== undefined && recording === undefined) {
        scope.logger.warn({ mbid }, 'catalog recording could not be presented');
      }
      if (recording === undefined) {
        scope.logger.debug({ mbid }, 'catalog identifier names nothing');
        return { kind: 'notFound' } satisfies CatalogLookup;
      }
      return { kind: 'found', entity: { kind: 'recording', recording } } satisfies CatalogLookup;
    });
  }

  discography(
    artist: Mbid,
    _scope: OperationScope,
  ): ResultAsync<readonly CatalogReleaseGroup[], InfraError> {
    return this.get(
      `${this.baseUrl}/release-group?artist=${artist}&fmt=json&limit=${BROWSE_LIMIT}`,
      mbReleaseGroupSearchSchema,
      DISCOGRAPHY_OPERATION,
    ).map((json) => toDiscography(json ?? {}));
  }

  editions(
    releaseGroup: Mbid,
    scope: OperationScope,
  ): ResultAsync<CatalogEditionListing, InfraError> {
    return this.get(
      `${this.baseUrl}/release?release-group=${releaseGroup}&inc=media&fmt=json&limit=${BROWSE_LIMIT}`,
      mbReleaseGroupBrowseSchema,
      EDITIONS_OPERATION,
    ).map((json) => {
      const listing = toEditionListing(json ?? {});
      const received = (json?.releases ?? []).length;
      // The preview keeps only releases it can address, so a group whose ids have all drifted
      // reads exactly like a group with no editions — and the surface then explains, confidently,
      // that the system would ask you to choose from a list that is empty.
      if (received > 0 && listing.groups.length === 0) {
        scope.logger.warn(
          { releaseGroup, received },
          'catalog listed editions none of which could be presented',
        );
      }
      return listing;
    });
  }

  tracklist(
    release: Mbid,
    _scope: OperationScope,
  ): ResultAsync<readonly CatalogTrack[], InfraError> {
    return this.get(
      `${this.baseUrl}/release/${release}?inc=recordings&fmt=json`,
      mbReleaseSchema,
      TRACKLIST_OPERATION,
    ).map((json) => (json === undefined ? [] : toTracks(json)));
  }

  /**
   * One validated GET. A 404 is `undefined` — the catalog saying "no such thing", which every
   * caller reads as an empty answer rather than a fault. Whether an answer is remembered, and
   * whether two identical reads share one request, belongs to the client this is given: see
   * `cachingHttpClient`, which the composition root wraps this adapter's client in.
   */
  private get<T>(
    url: string,
    schema: ZodType<T>,
    operation: string,
  ): ResultAsync<T | undefined, InfraError> {
    return this.fetchJson(url, schema, operation);
  }

  private fetchJson<T>(
    url: string,
    schema: ZodType<T>,
    operation: string,
  ): ResultAsync<T | undefined, InfraError> {
    return sendSafely(this.http, {
      url,
      headers: { 'User-Agent': this.userAgent, Accept: 'application/json' },
    })
      .mapErr((cause) => infraError(operation, 'the catalog could not be reached', cause))
      .andThen((response): Result<T | undefined, InfraError> => {
        // The catalog saying "no such thing" is an answer, not a fault.
        if (response.status === 404) return ok(undefined);
        // 429 and 408 are the provider asking for less, or for the same again — the one class of
        // 4xx that retrying is the correct answer to. Marking them permanent would turn a moment
        // of backpressure into a search that stays broken until someone restarts something.
        if (response.status === TOO_MANY_REQUESTS || response.status === REQUEST_TIMEOUT) {
          return err(infraError(operation, `the catalog answered ${response.status}`));
        }
        if (response.status >= 400 && response.status < 500) {
          // A refusal of the request we built — a query it cannot parse, an unsupported parameter.
          // Retrying reproduces it exactly, so it is permanent rather than a passing fault.
          return err(
            permanentInfraError(operation, `the catalog refused the request (${response.status})`),
          );
        }
        if (response.status < 200 || response.status >= 300) {
          return err(infraError(operation, `the catalog responded ${response.status}`));
        }
        return parseJson(response.body)
          .mapErr((cause) =>
            permanentInfraError(operation, 'the catalog returned malformed JSON', cause),
          )
          .andThen((json) => {
            const parsed = schema.safeParse(json);
            return parsed.success
              ? ok<T | undefined, InfraError>(parsed.data)
              : err<T | undefined, InfraError>(
                  permanentInfraError(operation, 'the catalog’s shape has drifted', parsed.error),
                );
          });
      });
  }
}
