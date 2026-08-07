import type { CorrelationSource } from '../ports/system-ports.js';
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
import type {
  ImportStatusProjection,
  ImportStatusView,
  PendingReviewView,
  StalledReadModel,
} from '../projections/read-models.js';
import type { CommandContext } from '../correlation/context.js';
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
  /** Mints a story where a trigger has none to carry — see `operation-correlation`. */
  readonly correlation: CorrelationSource;
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
  context: CommandContext,
): ResultAsync<{ readonly importId: ImportId }, CommandError> {
  const directory = normalizeDirectory(input.directory);
  const importId = importIdFor(directory);
  return applyCommand(
    dependencies,
    importId,
    {
      type: 'SubmitImport',
      directory,
      hints: input.hints,
      policy: dependencies.policy,
      source: input.source,
    },
    context,
  ).map(() => ({ importId }));
}

export function resolveReview(
  dependencies: UseCaseDependencies,
  importId: ImportId,
  resolution: Resolution,
  context: CommandContext,
): ResultAsync<void, CommandError> {
  return applyCommand(dependencies, importId, { type: 'ResolveReview', resolution }, context).map(
    () => {},
  );
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
 * (`importIdForAcquisition`): an O(1) index step, then a single-stream projection — never a
 * scan of all imports.
 */
export function getImportForAcquisition(
  dependencies: UseCaseDependencies,
  acquisitionId: string,
): ImportStatusView | undefined {
  const importId = dependencies.status.importIdForAcquisition(toAcquisitionId(acquisitionId));
  // RECORDED SURVIVOR, waiver withheld: forcing this ternary's condition false is equivalent. With
  // nothing indexed, `getImport` would look the missing id up in the projection's map, miss, and
  // answer `undefined` anyway. The guard states the absence rather than round-tripping a missing
  // key through the read model, and is the narrowing `ImportId` needs. Forcing it TRUE blanks every
  // acquisition's import — a real finding, on this same line under the same mutator, which is
  // exactly why the line takes no `disable next-line`.
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
