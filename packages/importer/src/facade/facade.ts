import { z } from 'zod';
import type { CommandError } from '../application/import/command-handler.js';
import {
  getImport as getImportUseCase,
  getImportForAcquisition as getImportForAcquisitionUseCase,
  listImports as listImportsUseCase,
  listPendingReviews as listPendingReviewsUseCase,
  resolveReview as resolveReviewUseCase,
  submitImport as submitImportUseCase,
} from '../application/import/use-cases.js';
import type { UseCaseDeps } from '../application/import/use-cases.js';
import { toImportId } from '../domain/shared/import-id.js';
import {
  hintsToDomain,
  pendingReviewToDto,
  resolutionToDomain,
  statusViewToDto,
} from './mapping.js';
import {
  importListResponseSchema,
  importStatusResponseSchema,
  resolveReviewRequestSchema,
  reviewListResponseSchema,
  submitImportRequestSchema,
} from './schemas.js';
import type { ImportListResponseDto, ImportStatusResponseDto } from './schemas.js';

/**
 * The importer module's wire-shaped facade (module-architecture D2): the single entry point any
 * interface — web BFF, HTTP, MCP — drives the module through. Commands and queries take and return
 * plain serializable DTOs, inputs are zod-validated here (an interface may pre-validate, but this
 * boundary owns correctness), and every expected failure is a modeled error value. Because the
 * DTOs are wire-shaped, binding this facade to a transport later — or swapping the in-process
 * implementation for a client — is a mechanical projection.
 */

// --- Errors ------------------------------------------------------------------------------------

export const importerFacadeErrorSchema = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('ValidationFailed'), message: z.string() }),
  z.object({ kind: z.literal('NotFound') }),
  z.object({ kind: z.literal('UnknownImport') }),
  z.object({ kind: z.literal('NoOpenReview') }),
  z.object({ kind: z.literal('InvalidResolution'), detail: z.string() }),
  z.object({ kind: z.literal('UnknownCandidate'), candidate: z.string() }),
  z.object({ kind: z.literal('NoRetainedCandidate') }),
  z.object({
    kind: z.literal('ConcurrencyConflict'),
    streamId: z.string(),
    expectedVersion: z.number(),
  }),
  z.object({ kind: z.literal('InfraError'), operation: z.string(), message: z.string() }),
]);

export type ImporterFacadeError = z.infer<typeof importerFacadeErrorSchema>;

export type FacadeResult<T> =
  | { readonly ok: true; readonly value: T }
  | { readonly ok: false; readonly error: ImporterFacadeError };

const ok = <T>(value: T): FacadeResult<T> => ({ ok: true, value });
const fail = <T>(error: ImporterFacadeError): FacadeResult<T> => ({ ok: false, error });

function validationFailed<T>(error: z.ZodError): FacadeResult<T> {
  return fail({
    kind: 'ValidationFailed',
    message: error.issues.map((issue) => issue.message).join('; '),
  });
}

/** Command failures pass through as values; the infra fault drops its non-serializable `cause`. */
function toFacadeError(error: CommandError): ImporterFacadeError {
  if (error.kind === 'InfraError') {
    return { kind: 'InfraError', operation: error.operation, message: error.message };
  }
  return error;
}

// --- Input/output schemas ----------------------------------------------------------------------

export const importIdInputSchema = z.object({ id: z.string().min(1) });

export const acquisitionIdInputSchema = z.object({ acquisitionId: z.string().min(1) });

export const resolveReviewInputSchema = z.object({
  id: z.string().min(1),
  resolution: resolveReviewRequestSchema,
});

export const submitImportResultSchema = z.object({ importId: z.string() });
export const resolveReviewResultSchema = z.object({ importId: z.string() });
export const importStatusResultSchema = importStatusResponseSchema;
export const importListResultSchema = importListResponseSchema;
export const reviewListResultSchema = reviewListResponseSchema;

export type ReviewListResponse = z.infer<typeof reviewListResultSchema>;
export type SubmitImportResult = z.infer<typeof submitImportResultSchema>;
export type ResolveReviewResult = z.infer<typeof resolveReviewResultSchema>;

// --- The facade --------------------------------------------------------------------------------

export interface ImporterFacade {
  submitImport(input: unknown): Promise<FacadeResult<SubmitImportResult>>;
  resolveReview(input: unknown): Promise<FacadeResult<ResolveReviewResult>>;
  getImport(input: unknown): FacadeResult<ImportStatusResponseDto>;
  /** The import an acquisition was submitted as — the web timeline's correlation read. */
  getImportForAcquisition(input: unknown): FacadeResult<ImportStatusResponseDto>;
  /** Infallible collection reads: return the DTO directly, no result envelope. */
  listImports(): ImportListResponseDto;
  listPendingReviews(): ReviewListResponse;
}

export function createImporterFacade(deps: UseCaseDeps): ImporterFacade {
  return {
    async submitImport(input) {
      const parsed = submitImportRequestSchema.safeParse(input);
      if (!parsed.success) return validationFailed(parsed.error);
      const result = await submitImportUseCase(deps, {
        directory: parsed.data.path,
        hints: hintsToDomain(parsed.data),
      });
      return result.match(
        ({ importId }) => ok({ importId }),
        (error) => fail(toFacadeError(error)),
      );
    },

    async resolveReview(input) {
      const parsed = resolveReviewInputSchema.safeParse(input);
      if (!parsed.success) return validationFailed(parsed.error);
      const result = await resolveReviewUseCase(
        deps,
        // Schema-proven non-empty above; lift the addressed id into its brand for the use-case.
        toImportId(parsed.data.id),
        resolutionToDomain(parsed.data.resolution),
      );
      return result.match(
        () => ok({ importId: parsed.data.id }),
        (error) => fail(toFacadeError(error)),
      );
    },

    getImport(input) {
      const parsed = importIdInputSchema.safeParse(input);
      if (!parsed.success) return validationFailed(parsed.error);
      const view = getImportUseCase(deps, toImportId(parsed.data.id));
      if (view === undefined) return fail({ kind: 'NotFound' });
      return ok(statusViewToDto(view));
    },

    getImportForAcquisition(input) {
      const parsed = acquisitionIdInputSchema.safeParse(input);
      if (!parsed.success) return validationFailed(parsed.error);
      const view = getImportForAcquisitionUseCase(deps, parsed.data.acquisitionId);
      if (view === undefined) return fail({ kind: 'NotFound' });
      return ok(statusViewToDto(view));
    },

    listImports() {
      return { imports: listImportsUseCase(deps).map(statusViewToDto) };
    },

    listPendingReviews() {
      return { reviews: listPendingReviewsUseCase(deps).map(pendingReviewToDto) };
    },
  };
}
