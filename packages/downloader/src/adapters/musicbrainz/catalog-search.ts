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
import type { Clock } from '../../application/ports/system-ports.js';
import type { OperationScope } from '../../application/correlation/context.js';
import type { HttpClient } from '../support/http.js';
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
 * so instead every request identifies this application, a repeated read inside the cache window is
 * answered from memory, concurrent identical reads share one request, and a search costs a fixed
 * three upstream reads however many results come back. Tracklists are never fetched for search
 * hits — only when a person opens one.
 *
 * Errors are values throughout: the vendor's throwing surfaces (`fetch`, `JSON.parse`) are
 * converted at the call site, schema validation uses zod's non-throwing `safeParse`, and drift is
 * marked permanent because retrying a changed provider shape cannot fix it.
 */

const DEFAULT_BASE_URL = 'https://musicbrainz.org/ws/2';
const DEFAULT_USER_AGENT = 'music-downloader/1.0 (https://github.com/jgchk/music-downloader)';
/** Per entity kind. Wide enough that ranking has real candidates to reorder, not a pre-cut list. */
const DEFAULT_SEARCH_LIMIT = 25;
/** Long enough to cover a person's typing and second thoughts, short enough to stay current. */
const DEFAULT_CACHE_TTL_MS = 120_000;
/** One release group's editions: MusicBrainz's own browse ceiling. */
const EDITION_LIMIT = 100;

const SEARCH_OPERATION = 'musicbrainz.catalog.search';
const LOOKUP_OPERATION = 'musicbrainz.catalog.lookup';
const DISCOGRAPHY_OPERATION = 'musicbrainz.catalog.discography';
const EDITIONS_OPERATION = 'musicbrainz.catalog.editions';
const TRACKLIST_OPERATION = 'musicbrainz.catalog.tracklist';

export interface CatalogSearchConfig {
  readonly baseUrl?: string;
  readonly userAgent?: string;
  readonly searchLimit?: number;
  readonly cacheTtlMs?: number;
}

const systemClock: Clock = { now: () => new Date() };

const parseJson = Result.fromThrowable(
  (body: string): unknown => JSON.parse(body),
  (cause) => cause,
);

interface CacheEntry {
  readonly at: number;
  readonly value: unknown;
}

export class MusicBrainzCatalogSearch implements CatalogSearchPort {
  private readonly baseUrl: string;
  private readonly userAgent: string;
  private readonly searchLimit: number;
  private readonly cacheTtlMs: number;
  /** Fresh answers, keyed by the exact URL that produced them. */
  private readonly cache = new Map<string, CacheEntry>();
  /** Reads already on the wire, so identical concurrent callers wait on one request. */
  private readonly inFlight = new Map<string, ResultAsync<unknown, InfraError>>();

  constructor(
    private readonly http: HttpClient = fetchHttpClient,
    config: CatalogSearchConfig = {},
    private readonly clock: Clock = systemClock,
  ) {
    this.baseUrl = config.baseUrl ?? DEFAULT_BASE_URL;
    this.userAgent = config.userAgent ?? DEFAULT_USER_AGENT;
    this.searchLimit = config.searchLimit ?? DEFAULT_SEARCH_LIMIT;
    this.cacheTtlMs = config.cacheTtlMs ?? DEFAULT_CACHE_TTL_MS;
  }

  search(query: string, scope: OperationScope): ResultAsync<CatalogSearchResults, InfraError> {
    const trimmed = query.trim();
    // A blank query asks nothing, so it costs the catalog nothing.
    if (trimmed === '') {
      return okAsync({ releaseGroups: [], artists: [], recordings: [], leading: 'release-group' });
    }
    const encoded = encodeURIComponent(trimmed);
    const limit = this.searchLimit;
    return ResultAsync.combine([
      this.get(
        `${this.baseUrl}/release-group?query=${encoded}&fmt=json&limit=${limit}`,
        mbReleaseGroupSearchSchema,
        SEARCH_OPERATION,
      ),
      this.get(
        `${this.baseUrl}/artist?query=${encoded}&fmt=json&limit=${limit}`,
        mbArtistSearchSchema,
        SEARCH_OPERATION,
      ),
      this.get(
        `${this.baseUrl}/recording?query=${encoded}&inc=releases&fmt=json&limit=${limit}`,
        mbCatalogRecordingSearchSchema,
        SEARCH_OPERATION,
      ),
    ]).map(([groupsJson, artistsJson, recordingsJson]) => {
      const releaseGroups = rankReleaseGroups(trimmed, toReleaseGroups(groupsJson ?? {}));
      const artists = rankArtists(trimmed, toArtists(artistsJson ?? {}));
      const recordings = rankRecordings(trimmed, toRecordings(recordingsJson ?? {}));
      scope.logger.debug(
        {
          releaseGroups: releaseGroups.length,
          artists: artists.length,
          recordings: recordings.length,
        },
        'catalog search answered',
      );
      return {
        releaseGroups,
        artists,
        recordings,
        leading: leadingKind(trimmed, { releaseGroups, artists, recordings }),
      };
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
    )
      .andThen((group) => {
        const [releaseGroup] = toReleaseGroups({ 'release-groups': group === undefined ? [] : [group] });
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
      if (artist !== undefined) return okAsync<CatalogLookup>({ kind: 'found', entity: { kind: 'artist', artist } });
      return this.lookupRecording(mbid, scope);
    });
  }

  private lookupRecording(mbid: Mbid, scope: OperationScope): ResultAsync<CatalogLookup, InfraError> {
    return this.get(
      `${this.baseUrl}/recording/${mbid}?inc=artist-credits+releases&fmt=json`,
      mbCatalogRecordingEntitySchema,
      LOOKUP_OPERATION,
    ).map((found) => {
      const [recording] = toRecordings({ recordings: found === undefined ? [] : [found] });
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
      `${this.baseUrl}/release-group?artist=${artist}&fmt=json&limit=${EDITION_LIMIT}`,
      mbReleaseGroupSearchSchema,
      DISCOGRAPHY_OPERATION,
    ).map((json) => toDiscography(json ?? {}));
  }

  editions(
    releaseGroup: Mbid,
    _scope: OperationScope,
  ): ResultAsync<CatalogEditionListing, InfraError> {
    return this.get(
      `${this.baseUrl}/release?release-group=${releaseGroup}&inc=media&fmt=json&limit=${EDITION_LIMIT}`,
      mbReleaseGroupBrowseSchema,
      EDITIONS_OPERATION,
    ).map((json) => toEditionListing(json ?? {}));
  }

  tracklist(release: Mbid, _scope: OperationScope): ResultAsync<readonly CatalogTrack[], InfraError> {
    return this.get(
      `${this.baseUrl}/release/${release}?inc=recordings&fmt=json`,
      mbReleaseSchema,
      TRACKLIST_OPERATION,
    ).map((json) => (json === undefined ? [] : toTracks(json)));
  }

  /**
   * One cached, shared, validated GET. A 404 is `undefined` — the catalog saying "no such thing",
   * which every caller reads as an empty answer rather than a fault. Only successful reads are
   * cached: a fault must never be remembered as an answer.
   */
  private get<T>(url: string, schema: ZodType<T>, operation: string): ResultAsync<T | undefined, InfraError> {
    const fresh = this.cached(url);
    if (fresh !== undefined) return okAsync(fresh.value as T | undefined);

    // Deriving from the shared instance rather than re-issuing: `map` returns a new ResultAsync
    // over the SAME pending request, so every concurrent caller is served by one read.
    const existing = this.inFlight.get(url);
    if (existing !== undefined) return existing.map((value) => value as T | undefined);

    const pending: ResultAsync<unknown, InfraError> = this.fetchJson(url, schema, operation)
      .map((value): unknown => {
        this.cache.set(url, { at: this.clock.now().getTime(), value });
        return value;
      })
      .andTee(() => this.inFlight.delete(url))
      .orTee(() => this.inFlight.delete(url));

    this.inFlight.set(url, pending);
    return pending.map((value) => value as T | undefined);
  }

  private cached(url: string): CacheEntry | undefined {
    const entry = this.cache.get(url);
    if (entry === undefined) return undefined;
    if (this.clock.now().getTime() - entry.at > this.cacheTtlMs) {
      this.cache.delete(url);
      return undefined;
    }
    return entry;
  }

  private fetchJson<T>(
    url: string,
    schema: ZodType<T>,
    operation: string,
  ): ResultAsync<T | undefined, InfraError> {
    return ResultAsync.fromPromise(
      this.http.send({ url, headers: { 'User-Agent': this.userAgent, Accept: 'application/json' } }),
      (cause) => infraError(operation, 'the catalog could not be reached', cause),
    ).andThen((response): Result<T | undefined, InfraError> => {
      // The catalog saying "no such thing" is an answer, not a fault.
      if (response.status === 404) return ok(undefined);
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
