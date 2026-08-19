import { err, ok as okResult } from 'neverthrow';
import { z } from 'zod';
import type { Result } from 'neverthrow';
import type { CommandError } from '../application/download/command-handler.js';
import type { InfraError } from '../application/ports/errors.js';
import { adoptOrMint } from '../application/correlation/context.js';
import type { CommandContext } from '../application/correlation/context.js';
import { parseMbid } from '../domain/shared/mbid.js';
import {
  cancelAcquisition as cancelDownloadUseCase,
  getAcquisition as getDownloadUseCase,
  getAcquisitionProgress as getProgressUseCase,
  listAcquisitions as listDownloadsUseCase,
  selectEdition as selectEditionUseCase,
  submitAcquisition as submitDownloadUseCase,
} from '../application/download/use-cases.js';
import type { UseCaseDependencies } from '../application/download/use-cases.js';
import { operationScope } from '../application/correlation/context.js';
import {
  discographyToDto,
  editionsToDto,
  lookupToDto,
  searchResultsToDto,
  tracklistToDto,
} from './catalog-dto.js';
import { progressToDto, requestToDomain, resolvePolicies, statusViewToDto } from './mapping.js';
import { submitAcquisitionRequestSchema } from './schemas.js';
import type {
  AcquisitionListResponseDto,
  AcquisitionStatusResponseDto,
  ProgressResponseDto,
} from './schemas.js';
import type {
  CatalogDiscographyResultDto,
  CatalogEditionsResultDto,
  CatalogLookupResultDto,
  CatalogSearchResultDto,
  CatalogTracklistResultDto,
} from './catalog-dto.js';
import type { CatalogSearchPort } from '../application/ports/catalog-search-port.js';
import type { Logger } from '../application/logging/logger.js';
import type { OperationScope } from '../application/correlation/context.js';
import type { Mbid } from '../domain/shared/mbid.js';

/**
 * The downloader module's wire-shaped facade (module-architecture D2): the single entry point any
 * interface — web BFF, HTTP, MCP — drives the module through. Commands and queries take and return
 * plain serializable DTOs, inputs are zod-validated here (an interface may pre-validate, but this
 * boundary owns correctness), and every expected failure is a modeled error value. Because the
 * DTOs are wire-shaped, binding this facade to a transport later (HTTP, CLI, MCP) — or swapping
 * the in-process implementation for a client — is a mechanical projection.
 */

// --- Errors ------------------------------------------------------------------------------------

export const downloaderFacadeErrorSchema = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('ValidationFailed'), message: z.string() }),
  z.object({ kind: z.literal('InvalidPolicy') }),
  z.object({ kind: z.literal('NotFound') }),
  z.object({ kind: z.literal('AlreadyExists') }),
  z.object({ kind: z.literal('IllegalTransition'), command: z.string(), phase: z.string() }),
  // A SelectEdition naming a release outside the retained candidates (manual-edition-selection).
  z.object({ kind: z.literal('UnknownEdition'), releaseMbid: z.string() }),
  z.object({
    kind: z.literal('ConcurrencyConflict'),
    streamId: z.string(),
    expectedVersion: z.number(),
  }),
  z.object({
    kind: z.literal('InfraError'),
    operation: z.string(),
    message: z.string(),
    /**
     * Whether retrying is futile — the adapter's own classification (schema drift, a refusal it
     * recognized) rather than a guess. Additive and optional: an older producer simply does not
     * say, and a reader that cannot tell must treat the fault as possibly-transient.
     */
    permanent: z.boolean().optional(),
  }),
]);

export type DownloaderFacadeError = z.infer<typeof downloaderFacadeErrorSchema>;

export type FacadeResult<T> =
  | { readonly ok: true; readonly value: T }
  | { readonly ok: false; readonly error: DownloaderFacadeError };

const ok = <T>(value: T): FacadeResult<T> => ({ ok: true, value });
const fail = <T>(error: DownloaderFacadeError): FacadeResult<T> => ({ ok: false, error });

function validationFailed<T>(error: z.ZodError): FacadeResult<T> {
  return fail({
    kind: 'ValidationFailed',
    message: error.issues.map((issue) => issue.message).join('; '),
  });
}

/** Command failures pass through as values; the infra fault drops its non-serializable `cause`. */
function toFacadeError(error: CommandError): DownloaderFacadeError {
  if (error.kind === 'InfraError') {
    return {
      kind: 'InfraError',
      operation: error.operation,
      message: error.message,
      permanent: error.permanent,
    };
  }
  return error;
}

// --- Input/output schemas ----------------------------------------------------------------------

export const acquisitionIdInputSchema = z.object({ id: z.string().min(1) });
export const selectEditionInputSchema = z.object({
  id: z.string().min(1),
  releaseMbid: z.string().min(1),
});

/** The catalog reads: a free-text query, or one identifier naming a thing in the catalog. */
export const catalogSearchInputSchema = z.object({ query: z.string() });
export const catalogIdInputSchema = z.object({ mbid: z.string().min(1) });

export const submitAcquisitionResultSchema = z.object({ acquisitionId: z.string() });
export const cancelAcquisitionResultSchema = z.object({ acquisitionId: z.string() });
export const selectEditionResultSchema = z.object({ acquisitionId: z.string() });

export type SubmitAcquisitionResult = z.infer<typeof submitAcquisitionResultSchema>;
export type CancelAcquisitionResult = z.infer<typeof cancelAcquisitionResultSchema>;
export type SelectEditionResult = z.infer<typeof selectEditionResultSchema>;

/**
 * Parse a catalog identifier at the boundary. A malformed id is a validation failure rather than
 * a lookup that answers "nothing": the caller asked something that cannot be true of any catalog.
 */
function catalogMbid(input: unknown): Result<Mbid, DownloaderFacadeError> {
  const parsed = catalogIdInputSchema.safeParse(input);
  if (!parsed.success) {
    return err({
      kind: 'ValidationFailed',
      message: parsed.error.issues.map((issue) => issue.message).join('; '),
    });
  }
  const mbid = parseMbid(parsed.data.mbid);
  if (mbid.isErr()) {
    return err({ kind: 'ValidationFailed', message: 'not a MusicBrainz identifier' });
  }
  return okResult(mbid.value);
}

// --- The facade --------------------------------------------------------------------------------

/**
 * The story a caller has already minted for the operation this command belongs to — 32 lowercase
 * hex (see `operation-correlation`). Deliberately a plain string, not this module's branded
 * `CorrelationId`: the facade is wire-shaped, and one caller drives BOTH modules under one story,
 * so neither module's brand may be the currency at this boundary. A malformed or unknown value
 * degrades to a freshly minted story — telemetry never refuses work.
 */
export type StoryId = string;

export interface DownloaderFacade {
  submitAcquisition(input: unknown, story: StoryId): Promise<FacadeResult<SubmitAcquisitionResult>>;
  cancelAcquisition(input: unknown, story: StoryId): Promise<FacadeResult<CancelAcquisitionResult>>;
  /** Resume an awaiting-selection download with the chosen edition (manual-edition-selection). */
  selectEdition(input: unknown, story: StoryId): Promise<FacadeResult<SelectEditionResult>>;
  getAcquisition(input: unknown): FacadeResult<AcquisitionStatusResponseDto>;
  /** Infallible collection read: returns the DTO directly, no result envelope. */
  listAcquisitions(): AcquisitionListResponseDto;
  getAcquisitionProgress(input: unknown): FacadeResult<ProgressResponseDto>;
  /**
   * The catalog reads a person formulates a request with. Unlike the projection reads above these
   * are asynchronous and carry a story, because they leave the process: they ask the upstream
   * catalog, and a catalog that cannot be reached is a fault the caller must be able to tell apart
   * from a search that simply matched nothing.
   */
  searchCatalog(input: unknown, story: StoryId): Promise<FacadeResult<CatalogSearchResultDto>>;
  lookupCatalog(input: unknown, story: StoryId): Promise<FacadeResult<CatalogLookupResultDto>>;
  browseArtist(input: unknown, story: StoryId): Promise<FacadeResult<CatalogDiscographyResultDto>>;
  listEditions(input: unknown, story: StoryId): Promise<FacadeResult<CatalogEditionsResultDto>>;
  getTracklist(input: unknown, story: StoryId): Promise<FacadeResult<CatalogTracklistResultDto>>;
}

/**
 * The catalog reads' own dependencies, kept apart from {@link UseCaseDependencies}: the catalog is
 * a read the FACADE offers, not a collaborator of the acquisition use-cases, and folding it into
 * their dependency object would tell every command about a port none of them may touch.
 */
export interface CatalogDependencies {
  readonly catalog: CatalogSearchPort;
  readonly logger: Logger;
}

export function createDownloaderFacade(
  dependencies: UseCaseDependencies,
  catalogDependencies: CatalogDependencies,
): DownloaderFacade {
  /**
   * Turn a caller's story into this module's command context. The degrade rule itself lives in the
   * correlation module — it is policy, not wire shaping, and a second interface (MCP, HTTP) would
   * otherwise copy it a third time.
   */
  const contextFor = (story: StoryId): CommandContext =>
    adoptOrMint(story, dependencies.correlation).context;

  /** The scope a catalog read runs under, so its lines join the caller's story. */
  const scopeFor = (story: StoryId): OperationScope =>
    operationScope(contextFor(story), catalogDependencies.logger);

  /**
   * A catalog fault, written down where the CAUSE still exists. `toFacadeError` drops it — the
   * wire cannot carry a zod issue list or a fetch error — so an interface above this one can only
   * ever log "the catalog's shape has drifted" and an operation name. The one fact that says WHICH
   * field moved lives here and nowhere else, and it is the whole diagnosis.
   */
  const catalogFailed = (read: string, error: InfraError): FacadeResult<never> => {
    // Typed as the port's own error rather than the whole command union: a catalog read fails
    // only as infrastructure, so there is no other kind of failure to branch on here.
    catalogDependencies.logger.warn(
      { read, operation: error.operation, permanent: error.permanent, cause: error.cause },
      error.message,
    );
    return fail(toFacadeError(error));
  };

  return {
    async submitAcquisition(input, story) {
      const parsed = submitAcquisitionRequestSchema.safeParse(input);
      if (!parsed.success) return validationFailed(parsed.error);
      const request = requestToDomain(parsed.data.request);
      if (request.isErr()) {
        return fail({
          kind: 'ValidationFailed',
          message: 'request carries a malformed MusicBrainz id',
        });
      }
      const policies = resolvePolicies(parsed.data);
      if (policies.isErr()) return fail({ kind: 'InvalidPolicy' });
      const result = await submitDownloadUseCase(
        dependencies,
        { request: request.value, policies: policies.value },
        contextFor(story),
      );
      return result.match(
        ({ acquisitionId }) => ok({ acquisitionId }),
        (error) => fail(toFacadeError(error)),
      );
    },

    async cancelAcquisition(input, story) {
      const parsed = acquisitionIdInputSchema.safeParse(input);
      if (!parsed.success) return validationFailed(parsed.error);
      const result = await cancelDownloadUseCase(dependencies, parsed.data.id, contextFor(story));
      return result.match(
        () => ok({ acquisitionId: parsed.data.id }),
        (error) => fail(toFacadeError(error)),
      );
    },

    async selectEdition(input, story) {
      const parsed = selectEditionInputSchema.safeParse(input);
      if (!parsed.success) return validationFailed(parsed.error);
      const releaseMbid = parseMbid(parsed.data.releaseMbid);
      if (releaseMbid.isErr()) {
        return fail({
          kind: 'ValidationFailed',
          message: 'releaseMbid is not a valid MusicBrainz id',
        });
      }
      const result = await selectEditionUseCase(
        dependencies,
        parsed.data.id,
        releaseMbid.value,
        contextFor(story),
      );
      return result.match(
        () => ok({ acquisitionId: parsed.data.id }),
        (error) => fail(toFacadeError(error)),
      );
    },

    getAcquisition(input) {
      const parsed = acquisitionIdInputSchema.safeParse(input);
      if (!parsed.success) return validationFailed(parsed.error);
      const view = getDownloadUseCase(dependencies, parsed.data.id);
      if (view === undefined) return fail({ kind: 'NotFound' });
      return ok(statusViewToDto(view));
    },

    listAcquisitions() {
      return {
        acquisitions: listDownloadsUseCase(dependencies).map((item) => statusViewToDto(item)),
      };
    },

    getAcquisitionProgress(input) {
      const parsed = acquisitionIdInputSchema.safeParse(input);
      if (!parsed.success) return validationFailed(parsed.error);
      const progress = getProgressUseCase(dependencies, parsed.data.id);
      if (progress === undefined) return fail({ kind: 'NotFound' });
      return ok(progressToDto(progress));
    },

    async searchCatalog(input, story) {
      const parsed = catalogSearchInputSchema.safeParse(input);
      if (!parsed.success) return validationFailed(parsed.error);
      const result = await catalogDependencies.catalog.search(parsed.data.query, scopeFor(story));
      return result.match(
        (results) => ok(searchResultsToDto(results)),
        (error) => catalogFailed('search', error),
      );
    },

    async lookupCatalog(input, story) {
      const mbid = catalogMbid(input);
      if (mbid.isErr()) return fail(mbid.error);
      const result = await catalogDependencies.catalog.lookup(mbid.value, scopeFor(story));
      return result.match(
        (lookup) => ok(lookupToDto(lookup)),
        (error) => catalogFailed('lookup', error),
      );
    },

    async browseArtist(input, story) {
      const mbid = catalogMbid(input);
      if (mbid.isErr()) return fail(mbid.error);
      const result = await catalogDependencies.catalog.discography(mbid.value, scopeFor(story));
      return result.match(
        (groups) => ok(discographyToDto(groups)),
        (error) => catalogFailed('discography', error),
      );
    },

    async listEditions(input, story) {
      const mbid = catalogMbid(input);
      if (mbid.isErr()) return fail(mbid.error);
      const result = await catalogDependencies.catalog.editions(mbid.value, scopeFor(story));
      return result.match(
        (listing) => ok(editionsToDto(listing)),
        (error) => catalogFailed('editions', error),
      );
    },

    async getTracklist(input, story) {
      const mbid = catalogMbid(input);
      if (mbid.isErr()) return fail(mbid.error);
      const result = await catalogDependencies.catalog.tracklist(mbid.value, scopeFor(story));
      return result.match(
        (tracks) => ok(tracklistToDto(tracks)),
        (error) => catalogFailed('tracklist', error),
      );
    },
  };
}

export {
  acquisitionListResponseSchema as acquisitionListResultSchema,
  acquisitionStatusResponseSchema as acquisitionStatusResultSchema,
  progressResponseSchema as progressResultSchema,
} from './schemas.js';
