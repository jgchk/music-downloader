import type { ResultAsync } from 'neverthrow';
import type { DownloadRequest } from '../../domain/download/events.js';
import type { CandidateReference } from '../../domain/candidate/candidate.js';
import type { DownloadPolicies } from '../../domain/policy/policies.js';
import type { Mbid } from '../../domain/shared/mbid.js';
import type { TransferProgress } from '../ports/outbound-ports.js';
import type { CorrelationSource, IdGenerator } from '../ports/system-ports.js';
import type {
  DownloadStatusProjection,
  DownloadStatusView,
  ProgressReadModel,
  StalledReadModel,
} from '../projections/read-models.js';
import type { CommandContext } from '../correlation/context.js';
import { applyCommand } from './command-handler.js';
import type { CommandDependencies, CommandError } from './command-handler.js';

/**
 * The application use-cases (D12): the real, stable API the interfaces (HTTP, MCP) map onto.
 * Commands are async submit-and-observe; queries read the projections synchronously.
 */
export interface UseCaseDependencies extends CommandDependencies {
  readonly ids: IdGenerator;
  /** Mints a story where a trigger has none to carry — see `operation-correlation`. */
  readonly correlation: CorrelationSource;
  readonly status: DownloadStatusProjection;
  readonly progress: ProgressReadModel;
  readonly stalled: StalledReadModel;
}

export interface SubmitAcquisitionInput {
  readonly request: DownloadRequest;
  readonly policies: DownloadPolicies;
}

export function submitAcquisition(
  dependencies: UseCaseDependencies,
  input: SubmitAcquisitionInput,
  context: CommandContext,
): ResultAsync<{ readonly acquisitionId: string }, CommandError> {
  const acquisitionId = dependencies.ids.next();
  return applyCommand(
    dependencies,
    acquisitionId,
    { type: 'SubmitAcquisition', request: input.request, policies: input.policies },
    context,
  ).map(() => ({ acquisitionId }));
}

export function cancelAcquisition(
  dependencies: UseCaseDependencies,
  acquisitionId: string,
  context: CommandContext,
): ResultAsync<void, CommandError> {
  return applyCommand(dependencies, acquisitionId, { type: 'CancelAcquisition' }, context).map(
    () => {},
  );
}

/**
 * Resume an download awaiting manual edition selection with the user's choice. `decide` is the
 * single guard: an off-menu edition or an download in any other state is a modeled rejection
 * (`UnknownEdition` / `IllegalTransition`) with no state change (manual-edition-selection D2).
 */
export function selectEdition(
  dependencies: CommandDependencies,
  acquisitionId: string,
  releaseMbid: Mbid,
  context: CommandContext,
): ResultAsync<void, CommandError> {
  return applyCommand(
    dependencies,
    acquisitionId,
    { type: 'SelectEdition', releaseMbid },
    context,
  ).map(() => {});
}

/** What an external adjudicator reported about a delivered candidate (fulfillment-external-verdict). */
export interface ExternalValidationFailureInput {
  readonly candidate: CandidateReference;
  readonly reasons: readonly string[];
}

/**
 * Record an external validation failure against an download. `decide` is the single guard: a
 * matching verdict on a revivable fulfilment revives the retry ladder; anything stale, mismatched,
 * or redelivered converges to a no-op — never an error — so redelivery over the verdict catch-up
 * subscription is safe end-to-end.
 */
export function recordExternalValidationFailure(
  dependencies: CommandDependencies,
  acquisitionId: string,
  input: ExternalValidationFailureInput,
  context: CommandContext,
): ResultAsync<void, CommandError> {
  return applyCommand(
    dependencies,
    acquisitionId,
    {
      type: 'RecordExternalValidationFailed',
      candidate: input.candidate,
      reasons: input.reasons,
    },
    context,
  ).map(() => {});
}

/** Join the stalled exposure onto a projected view — additive, absent unless dead-lettered. */
function withStalled(
  dependencies: UseCaseDependencies,
  view: DownloadStatusView,
): DownloadStatusView {
  return dependencies.stalled.isStalled(view.acquisitionId) ? { ...view, stalled: true } : view;
}

export function getAcquisition(
  dependencies: UseCaseDependencies,
  acquisitionId: string,
): DownloadStatusView | undefined {
  const view = dependencies.status.get(acquisitionId);
  return view === undefined ? undefined : withStalled(dependencies, view);
}

export function listAcquisitions(dependencies: UseCaseDependencies): readonly DownloadStatusView[] {
  return dependencies.status.list().map((view) => withStalled(dependencies, view));
}

export function getAcquisitionProgress(
  dependencies: UseCaseDependencies,
  acquisitionId: string,
): TransferProgress | undefined {
  return dependencies.progress.get(acquisitionId);
}
