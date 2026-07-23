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
import type { CommandDependencies, CommandError } from './command-handler.js';

/**
 * The application use-cases: the real, stable API the interfaces (HTTP, MCP) map onto. Commands
 * are async submit-and-observe; queries read the projection synchronously. An import is keyed by
 * its directory (D5): the stream id is derived from the normalized path, which is what makes
 * resubmission idempotent — the same directory always converges on the same stream.
 */
export interface UseCaseDependencies extends CommandDependencies {
  readonly status: ImportStatusProjection;
  readonly stalled: StalledReadModel;
  readonly policy: ImportPolicy;
}

/** Join the stalled exposure onto a projected view — additive, absent unless dead-lettered. */
function withStalled(dependencies: UseCaseDependencies, view: ImportStatusView): ImportStatusView {
  return dependencies.stalled.isStalled(view.importId) ? { ...view, stalled: true } : view;
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
  dependencies: UseCaseDependencies,
  input: SubmitImportInput,
): ResultAsync<{ readonly importId: ImportId }, CommandError> {
  const directory = normalizeDirectory(input.directory);
  const importId = importIdFor(directory);
  return applyCommand(dependencies, importId, {
    type: 'SubmitImport',
    directory,
    hints: input.hints,
    policy: dependencies.policy,
    source: input.source,
  }).map(() => ({ importId }));
}

/** The import an acquisition already submitted, if any — the intake consumer's convergence check. */
export function findAcquisitionImport(
  dependencies: UseCaseDependencies,
  acquisitionId: AcquisitionId,
): ImportId | undefined {
  return dependencies.status.importIdForAcquisition(acquisitionId);
}

export function resolveReview(
  dependencies: UseCaseDependencies,
  importId: ImportId,
  resolution: Resolution,
): ResultAsync<void, CommandError> {
  return applyCommand(dependencies, importId, { type: 'ResolveReview', resolution }).map(() => {});
}

export function getImport(
  dependencies: UseCaseDependencies,
  importId: ImportId,
): ImportStatusView | undefined {
  const view = dependencies.status.get(importId);
  return view === undefined ? undefined : withStalled(dependencies, view);
}

/**
 * The import that an acquisition was submitted as, if any — the read behind the web layer's
 * download-through-import timeline. Served from the same reverse index the intake consumer uses
 * (`importIdForAcquisition`), so it is an O(1) lookup, never a scan of all imports.
 */
export function getImportForAcquisition(
  dependencies: UseCaseDependencies,
  acquisitionId: string,
): ImportStatusView | undefined {
  const importId = dependencies.status.importIdForAcquisition(toAcquisitionId(acquisitionId));
  return importId === undefined ? undefined : getImport(dependencies, importId);
}

export function listImports(dependencies: UseCaseDependencies): readonly ImportStatusView[] {
  return dependencies.status.list().map((view) => withStalled(dependencies, view));
}

export function listPendingReviews(
  dependencies: UseCaseDependencies,
): readonly PendingReviewView[] {
  return dependencies.status.pendingReviews();
}
