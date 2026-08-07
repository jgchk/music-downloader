import { z } from 'zod';
import type { CommandError } from '../application/acquisition/command-handler.js';
import { adoptOrMint } from '../application/correlation/context.js';
import type { CommandContext } from '../application/correlation/context.js';
import { parseMbid } from '../domain/shared/mbid.js';
import {
  cancelAcquisition as cancelAcquisitionUseCase,
  getAcquisition as getAcquisitionUseCase,
  getAcquisitionProgress as getProgressUseCase,
  listAcquisitions as listAcquisitionsUseCase,
  selectEdition as selectEditionUseCase,
  submitAcquisition as submitAcquisitionUseCase,
} from '../application/acquisition/use-cases.js';
import type { UseCaseDependencies } from '../application/acquisition/use-cases.js';
import { progressToDto, requestToDomain, resolvePolicies, statusViewToDto } from './mapping.js';
import { submitAcquisitionRequestSchema } from './schemas.js';
import type {
  AcquisitionListResponseDto,
  AcquisitionStatusResponseDto,
  ProgressResponseDto,
} from './schemas.js';

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
  z.object({ kind: z.literal('InfraError'), operation: z.string(), message: z.string() }),
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
    return { kind: 'InfraError', operation: error.operation, message: error.message };
  }
  return error;
}

// --- Input/output schemas ----------------------------------------------------------------------

export const acquisitionIdInputSchema = z.object({ id: z.string().min(1) });
export const selectEditionInputSchema = z.object({
  id: z.string().min(1),
  releaseMbid: z.string().min(1),
});

export const submitAcquisitionResultSchema = z.object({ acquisitionId: z.string() });
export const cancelAcquisitionResultSchema = z.object({ acquisitionId: z.string() });
export const selectEditionResultSchema = z.object({ acquisitionId: z.string() });

export type SubmitAcquisitionResult = z.infer<typeof submitAcquisitionResultSchema>;
export type CancelAcquisitionResult = z.infer<typeof cancelAcquisitionResultSchema>;
export type SelectEditionResult = z.infer<typeof selectEditionResultSchema>;

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
  /** Resume an awaiting-selection acquisition with the chosen edition (manual-edition-selection). */
  selectEdition(input: unknown, story: StoryId): Promise<FacadeResult<SelectEditionResult>>;
  getAcquisition(input: unknown): FacadeResult<AcquisitionStatusResponseDto>;
  /** Infallible collection read: returns the DTO directly, no result envelope. */
  listAcquisitions(): AcquisitionListResponseDto;
  getAcquisitionProgress(input: unknown): FacadeResult<ProgressResponseDto>;
}

export function createDownloaderFacade(dependencies: UseCaseDependencies): DownloaderFacade {
  /**
   * Turn a caller's story into this module's command context. The degrade rule itself lives in the
   * correlation module — it is policy, not wire shaping, and a second interface (MCP, HTTP) would
   * otherwise copy it a third time.
   */
  const contextFor = (story: StoryId): CommandContext =>
    adoptOrMint(story, dependencies.correlation).context;

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
      const result = await submitAcquisitionUseCase(
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
      const result = await cancelAcquisitionUseCase(
        dependencies,
        parsed.data.id,
        contextFor(story),
      );
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
      const view = getAcquisitionUseCase(dependencies, parsed.data.id);
      if (view === undefined) return fail({ kind: 'NotFound' });
      return ok(statusViewToDto(view));
    },

    listAcquisitions() {
      return {
        acquisitions: listAcquisitionsUseCase(dependencies).map((item) => statusViewToDto(item)),
      };
    },

    getAcquisitionProgress(input) {
      const parsed = acquisitionIdInputSchema.safeParse(input);
      if (!parsed.success) return validationFailed(parsed.error);
      const progress = getProgressUseCase(dependencies, parsed.data.id);
      if (progress === undefined) return fail({ kind: 'NotFound' });
      return ok(progressToDto(progress));
    },
  };
}

export {
  acquisitionListResponseSchema as acquisitionListResultSchema,
  acquisitionStatusResponseSchema as acquisitionStatusResultSchema,
  progressResponseSchema as progressResultSchema,
} from './schemas.js';
