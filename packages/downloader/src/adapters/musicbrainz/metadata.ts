import { ResultAsync } from 'neverthrow';
import type { AcquisitionRequest } from '../../domain/acquisition/events.js';
import { infraError } from '../../application/ports/errors.js';
import type { InfraError } from '../../application/ports/errors.js';
import type { MetadataPort, MetadataResolution } from '../../application/ports/outbound-ports.js';
import type { Logger } from '../../application/logging/logger.js';
import type { ZodType } from 'zod';
import { fetchHttpClient } from '../support/http.js';
import type { HttpClient } from '../support/http.js';
import {
  bestMatchId,
  recordingToTarget,
  releaseCandidateIds,
  releaseGroupCandidateIds,
  releaseToTarget,
} from './mapping.js';
import {
  mbRecordingSchema,
  mbRecordingSearchSchema,
  mbReleaseGroupBrowseSchema,
  mbReleaseSchema,
  mbReleaseSearchSchema,
} from './schemas.js';

/**
 * The MusicBrainz `MetadataPort` adapter (D12). Resolves a request — by release/recording MBID, by
 * release-*group* MBID, or by structured descriptor — into a canonical {@link Target}. An album
 * descriptor searches, resolves the album's identity to a confident, unambiguous release group and
 * selects an edition within it ({@link releaseCandidateIds}), then fetches releases in order until
 * one yields a target; a release-group request browses the group's editions and selects a
 * representative official one ({@link releaseGroupCandidateIds}); a track descriptor uses the flat
 * {@link bestMatchId} guard. Not-found / no-confident-match is the *business* outcome `unresolved`;
 * only transport faults or unexpected HTTP statuses become an `InfraError`.
 */

const UNRESOLVED: MetadataResolution = { kind: 'unresolved' };

const DEFAULT_BASE_URL = 'https://musicbrainz.org/ws/2';
const DEFAULT_USER_AGENT = 'music-downloader/0.0 (https://github.com/anthropics/music-downloader)';

// A popular album returns many editions of one release group, so the album search must see enough of
// them to resolve one identity and pick an edition; MusicBrainz allows up to 100 hits per request.
const RELEASE_SEARCH_LIMIT = 100;

/** Escape a value for interpolation inside a quoted Lucene phrase (backslash and the quote). */
function lucenePhrase(value: string): string {
  return `"${value.replace(/[\\"]/g, (char) => `\\${char}`)}"`;
}

export interface MusicBrainzConfig {
  readonly baseUrl?: string;
  readonly userAgent?: string;
  readonly searchLimit?: number;
}

export class MusicBrainzMetadata implements MetadataPort {
  private readonly baseUrl: string;
  private readonly userAgent: string;
  private readonly searchLimit: number;

  constructor(
    private readonly logger: Logger,
    private readonly http: HttpClient = fetchHttpClient,
    config: MusicBrainzConfig = {},
  ) {
    this.baseUrl = config.baseUrl ?? DEFAULT_BASE_URL;
    this.userAgent = config.userAgent ?? DEFAULT_USER_AGENT;
    this.searchLimit = config.searchLimit ?? 5;
  }

  resolve(request: AcquisitionRequest): ResultAsync<MetadataResolution, InfraError> {
    return ResultAsync.fromPromise(this.doResolve(request), (cause) =>
      infraError('musicbrainz.resolve', String(cause), cause),
    );
  }

  private async doResolve(request: AcquisitionRequest): Promise<MetadataResolution> {
    this.logger.debug({ kind: request.kind, targetType: request.targetType }, 'resolving metadata');
    if (request.kind === 'musicbrainz') {
      return request.targetType === 'album'
        ? this.resolveReleaseById(request.mbid)
        : this.resolveRecordingById(request.mbid);
    }
    if (request.kind === 'release-group') {
      return this.resolveReleaseByReleaseGroup(request.mbid);
    }
    return request.targetType === 'album'
      ? this.resolveReleaseByDescriptor(request.artist, request.title)
      : this.resolveRecordingByDescriptor(request.artist, request.title);
  }

  private async resolveReleaseById(mbid: string): Promise<MetadataResolution> {
    const json = await this.getJson(
      `${this.baseUrl}/release/${encodeURIComponent(mbid)}?inc=recordings+artist-credits&fmt=json`,
      mbReleaseSchema,
    );
    if (json === undefined) return UNRESOLVED;
    const target = releaseToTarget(json);
    return target === undefined ? UNRESOLVED : { kind: 'resolved', target };
  }

  private async resolveRecordingById(mbid: string): Promise<MetadataResolution> {
    const json = await this.getJson(
      `${this.baseUrl}/recording/${encodeURIComponent(mbid)}?inc=artist-credits&fmt=json`,
      mbRecordingSchema,
    );
    if (json === undefined) return UNRESOLVED;
    const target = recordingToTarget(json);
    return target === undefined ? UNRESOLVED : { kind: 'resolved', target };
  }

  private async resolveReleaseByReleaseGroup(mbid: string): Promise<MetadataResolution> {
    const url = `${this.baseUrl}/release?release-group=${encodeURIComponent(mbid)}&inc=media&fmt=json&limit=${RELEASE_SEARCH_LIMIT}`;
    const json = await this.getJson(url, mbReleaseGroupBrowseSchema);
    for (const id of releaseGroupCandidateIds(json?.releases)) {
      const resolution = await this.resolveReleaseById(id);
      if (resolution.kind === 'resolved') return resolution;
    }
    return UNRESOLVED;
  }

  private async resolveReleaseByDescriptor(
    artist: string,
    title: string,
  ): Promise<MetadataResolution> {
    const query = `release:${lucenePhrase(title)} AND artist:${lucenePhrase(artist)}`;
    const url = this.searchUrl('release', query, RELEASE_SEARCH_LIMIT);
    const json = await this.getJson(url, mbReleaseSearchSchema);
    for (const id of releaseCandidateIds(json?.releases, title)) {
      const resolution = await this.resolveReleaseById(id);
      if (resolution.kind === 'resolved') return resolution;
    }
    return UNRESOLVED;
  }

  private async resolveRecordingByDescriptor(
    artist: string,
    title: string,
  ): Promise<MetadataResolution> {
    const query = `recording:${lucenePhrase(title)} AND artist:${lucenePhrase(artist)}`;
    const url = this.searchUrl('recording', query, this.searchLimit);
    const json = await this.getJson(url, mbRecordingSearchSchema);
    const id = bestMatchId(json?.recordings);
    return id === undefined ? UNRESOLVED : this.resolveRecordingById(id);
  }

  private searchUrl(entity: 'release' | 'recording', query: string, limit: number): string {
    return `${this.baseUrl}/${entity}?query=${encodeURIComponent(query)}&fmt=json&limit=${limit}`;
  }

  /**
   * GET and validate the body against the endpoint's contract schema; `undefined` for 404 (not
   * found) and 400 (invalid identifier), both of which map to the business outcome *unresolved*;
   * throw for other non-2xx. MusicBrainz answers a malformed/invalid mbid with `400 {"error":
   * "Invalid mbid."}` — a *permanent* condition that never succeeds on retry, so it must NOT become
   * an `InfraError` (which the reactor retries forever, wedging resolution); it is logged and
   * treated as unresolved. A body that violates the contract makes `schema.parse` throw, which the
   * `resolve` wrapper maps to an `InfraError` — provider drift surfaces as an attributable boundary
   * fault, never as malformed data reaching the mapping (D2).
   */
  private async getJson<T>(url: string, schema: ZodType<T>): Promise<T | undefined> {
    const response = await this.http.send({
      url,
      headers: { 'User-Agent': this.userAgent, Accept: 'application/json' },
    });
    if (response.status === 404) return undefined;
    if (response.status === 400) {
      this.logger.warn({ url }, 'musicbrainz rejected the request (400); treating as unresolved');
      return undefined;
    }
    if (response.status < 200 || response.status >= 300) {
      throw new Error(`MusicBrainz responded ${response.status}`);
    }
    return schema.parse(JSON.parse(response.body));
  }
}
