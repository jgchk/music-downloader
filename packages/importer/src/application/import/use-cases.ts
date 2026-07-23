import { createHash } from 'node:crypto';
import type { ResultAsync } from 'neverthrow';
import type {
  ImportHints,
  ImportPolicy,
  ImportSource,
  Resolution,
} from '../../domain/import/events.js';
import { toImportId } from '../../domain/shared/import-id.js';
import type { ImportId } from '../../domain/shared/import-id.js';
import { toAcquisitionId } from '../../domain/shared/acquisition-id.js';
import type { AcquisitionId } from '../../domain/shared/acquisition-id.js';
import type {
  ImportStatusProjection,
  ImportStatusView,
  PendingReviewView,
  StalledReadModel,
} from '../projections/read-models.js';
import { applyCommand } from './command-handler.js';
import type { CommandDeps, CommandError } from './command-handler.js';

/**
 * The application use-cases: the real, stable API the interfaces (HTTP, MCP) map onto. Commands
 * are async submit-and-observe; queries read the projection synchronously. An import is keyed by
 * its directory (D5): the stream id is derived from the normalized path, which is what makes
 * resubmission idempotent — the same directory always converges on the same stream.
 */
export interface UseCaseDeps extends CommandDeps {
  readonly status: ImportStatusProjection;
  readonly stalled: StalledReadModel;
  readonly policy: ImportPolicy;
}

/** Join the stalled exposure onto a projected view — additive, absent unless dead-lettered. */
function withStalled(deps: UseCaseDeps, view: ImportStatusView): ImportStatusView {
  return deps.stalled.isStalled(view.importId) ? { ...view, stalled: true } : view;
}

/** Normalize a submitted path (collapse trailing slashes) so cosmetic variants share a stream. */
function normalizeDirectory(directory: string): string {
  const trimmed = directory.replace(/\/+$/u, '');
  return trimmed === '' ? '/' : trimmed;
}

/** The deterministic stream id for a directory: stable, URL-safe, collision-resistant. */
export function importIdFor(directory: string): ImportId {
  const digest = createHash('sha256').update(normalizeDirectory(directory)).digest('hex');
  return toImportId(`imp-${digest.slice(0, 24)}`);
}

export interface SubmitImportInput {
  readonly directory: string;
  readonly hints?: ImportHints;
  /** Provenance of an event-driven submission, recorded for durable acquisition idempotency. */
  readonly source?: ImportSource;
}

export function submitImport(
  deps: UseCaseDeps,
  input: SubmitImportInput,
): ResultAsync<{ readonly importId: ImportId }, CommandError> {
  const directory = normalizeDirectory(input.directory);
  const importId = importIdFor(directory);
  return applyCommand(deps, importId, {
    type: 'SubmitImport',
    directory,
    hints: input.hints,
    policy: deps.policy,
    source: input.source,
  }).map(() => ({ importId }));
}

/** The import an acquisition already submitted, if any — the intake consumer's convergence check. */
export function findAcquisitionImport(
  deps: UseCaseDeps,
  acquisitionId: AcquisitionId,
): ImportId | undefined {
  return deps.status.importIdForAcquisition(acquisitionId);
}

export function resolveReview(
  deps: UseCaseDeps,
  importId: ImportId,
  resolution: Resolution,
): ResultAsync<void, CommandError> {
  return applyCommand(deps, importId, { type: 'ResolveReview', resolution }).map(() => undefined);
}

export function getImport(deps: UseCaseDeps, importId: ImportId): ImportStatusView | undefined {
  const view = deps.status.get(importId);
  return view === undefined ? undefined : withStalled(deps, view);
}

/**
 * The import that an acquisition was submitted as, if any — the read behind the web layer's
 * download-through-import timeline. Served from the same reverse index the intake consumer uses
 * (`importIdForAcquisition`), so it is an O(1) lookup, never a scan of all imports.
 */
export function getImportForAcquisition(
  deps: UseCaseDeps,
  acquisitionId: string,
): ImportStatusView | undefined {
  const importId = deps.status.importIdForAcquisition(toAcquisitionId(acquisitionId));
  return importId === undefined ? undefined : getImport(deps, importId);
}

export function listImports(deps: UseCaseDeps): readonly ImportStatusView[] {
  return deps.status.list().map((view) => withStalled(deps, view));
}

export function listPendingReviews(deps: UseCaseDeps): readonly PendingReviewView[] {
  return deps.status.pendingReviews();
}
