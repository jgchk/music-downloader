import { ResultAsync } from 'neverthrow';
import type { AcquisitionRequest } from '../../domain/acquisition/events.js';
import { infraError } from '../../application/ports/errors.js';
import type { InfraError } from '../../application/ports/errors.js';
import type { MetadataPort, MetadataResolution } from '../../application/ports/outbound-ports.js';
import type { Logger } from '../../application/logging/logger.js';
import type { ZodType } from 'zod';
import { fetchHttpClient } from '../support/http.js';
import type { HttpClient } from '../support/http.js';
import { bestMatchId, recordingToTarget, releaseToTarget } from './mapping.js';
import {
  mbRecordingSchema,
  mbRecordingSearchSchema,
  mbReleaseSchema,
  mbReleaseSearchSchema,
} from './schemas.js';

/**
 * The MusicBrainz `MetadataPort` adapter (D12). Resolves a request — by MBID or by structured
 * descriptor — into a canonical {@link Target}. A descriptor first searches, accepts the top hit
 * only when it is confident and unambiguous ({@link bestMatchId}), then fetches the full entity.
 * Not-found / no-confident-match is the *business* outcome `unresolved`; only transport faults or
 * unexpected HTTP statuses become an `InfraError`.
 */

const UNRESOLVED: MetadataResolution = { kind: 'unresolved' };

const DEFAULT_BASE_URL = 'https://musicbrainz.org/ws/2';
const DEFAULT_USER_AGENT = 'music-downloader/0.0 (https://github.com/anthropics/music-downloader)';

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

  private async resolveReleaseByDescriptor(
    artist: string,
    title: string,
  ): Promise<MetadataResolution> {
    const query = `release:"${title}" AND artist:"${artist}"`;
    const json = await this.getJson(this.searchUrl('release', query), mbReleaseSearchSchema);
    const id = bestMatchId(json?.releases);
    return id === undefined ? UNRESOLVED : this.resolveReleaseById(id);
  }

  private async resolveRecordingByDescriptor(
    artist: string,
    title: string,
  ): Promise<MetadataResolution> {
    const query = `recording:"${title}" AND artist:"${artist}"`;
    const json = await this.getJson(this.searchUrl('recording', query), mbRecordingSearchSchema);
    const id = bestMatchId(json?.recordings);
    return id === undefined ? UNRESOLVED : this.resolveRecordingById(id);
  }

  private searchUrl(entity: 'release' | 'recording', query: string): string {
    return `${this.baseUrl}/${entity}?query=${encodeURIComponent(query)}&fmt=json&limit=${this.searchLimit}`;
  }

  /**
   * GET and validate the body against the endpoint's contract schema; `undefined` for 404 (not
   * found → unresolved), throw for other non-2xx. A body that violates the contract makes
   * `schema.parse` throw, which the `resolve` wrapper maps to an `InfraError` — provider drift
   * surfaces as an attributable boundary fault, never as malformed data reaching the mapping (D2).
   */
  private async getJson<T>(url: string, schema: ZodType<T>): Promise<T | undefined> {
    const response = await this.http.send({
      url,
      headers: { 'User-Agent': this.userAgent, Accept: 'application/json' },
    });
    if (response.status === 404) return undefined;
    if (response.status < 200 || response.status >= 300) {
      throw new Error(`MusicBrainz responded ${response.status}`);
    }
    return schema.parse(JSON.parse(response.body));
  }
}
