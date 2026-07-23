import type { ResultAsync } from 'neverthrow';
import type { AcquisitionRequest } from '../../domain/acquisition/events.js';
import type { CandidateRef } from '../../domain/candidate/candidate.js';
import type { AcquisitionPolicies } from '../../domain/policy/policies.js';
import type { Mbid } from '../../domain/shared/mbid.js';
import type { DownloadProgress } from '../ports/outbound-ports.js';
import type { IdGenerator } from '../ports/system-ports.js';
import type {
  AcquisitionStatusProjection,
  AcquisitionStatusView,
  ProgressReadModel,
  StalledReadModel,
} from '../projections/read-models.js';
import { applyCommand } from './command-handler.js';
import type { CommandDeps, CommandError } from './command-handler.js';

/**
 * The application use-cases (D12): the real, stable API the interfaces (HTTP, MCP) map onto.
 * Commands are async submit-and-observe; queries read the projections synchronously.
 */
export interface UseCaseDeps extends CommandDeps {
  readonly ids: IdGenerator;
  readonly status: AcquisitionStatusProjection;
  readonly progress: ProgressReadModel;
  readonly stalled: StalledReadModel;
}

export interface SubmitAcquisitionInput {
  readonly request: AcquisitionRequest;
  readonly policies: AcquisitionPolicies;
}

export function submitAcquisition(
  deps: UseCaseDeps,
  input: SubmitAcquisitionInput,
): ResultAsync<{ readonly acquisitionId: string }, CommandError> {
  const acquisitionId = deps.ids.next();
  return applyCommand(deps, acquisitionId, {
    type: 'SubmitAcquisition',
    request: input.request,
    policies: input.policies,
  }).map(() => ({ acquisitionId }));
}

export function cancelAcquisition(
  deps: UseCaseDeps,
  acquisitionId: string,
): ResultAsync<void, CommandError> {
  return applyCommand(deps, acquisitionId, { type: 'CancelAcquisition' }).map(() => undefined);
}

/**
 * Resume an acquisition awaiting manual edition selection with the user's choice. `decide` is the
 * single guard: an off-menu edition or an acquisition in any other state is a modeled rejection
 * (`UnknownEdition` / `IllegalTransition`) with no state change (manual-edition-selection D2).
 */
export function selectEdition(
  deps: CommandDeps,
  acquisitionId: string,
  releaseMbid: Mbid,
): ResultAsync<void, CommandError> {
  return applyCommand(deps, acquisitionId, { type: 'SelectEdition', releaseMbid }).map(
    () => undefined,
  );
}

/** What an external adjudicator reported about a delivered candidate (fulfillment-external-verdict). */
export interface ExternalValidationFailureInput {
  readonly candidate: CandidateRef;
  readonly reasons: readonly string[];
}

/**
 * Record an external validation failure against an acquisition. `decide` is the single guard: a
 * matching verdict on a revivable fulfilment revives the retry ladder; anything stale, mismatched,
 * or redelivered converges to a no-op — never an error — so redelivery over the verdict catch-up
 * subscription is safe end-to-end.
 */
export function recordExternalValidationFailure(
  deps: CommandDeps,
  acquisitionId: string,
  input: ExternalValidationFailureInput,
): ResultAsync<void, CommandError> {
  return applyCommand(deps, acquisitionId, {
    type: 'RecordExternalValidationFailed',
    candidate: input.candidate,
    reasons: input.reasons,
  }).map(() => undefined);
}

/** Join the stalled exposure onto a projected view — additive, absent unless dead-lettered. */
function withStalled(deps: UseCaseDeps, view: AcquisitionStatusView): AcquisitionStatusView {
  return deps.stalled.isStalled(view.acquisitionId) ? { ...view, stalled: true } : view;
}

export function getAcquisition(
  deps: UseCaseDeps,
  acquisitionId: string,
): AcquisitionStatusView | undefined {
  const view = deps.status.get(acquisitionId);
  return view === undefined ? undefined : withStalled(deps, view);
}

export function listAcquisitions(deps: UseCaseDeps): readonly AcquisitionStatusView[] {
  return deps.status.list().map((view) => withStalled(deps, view));
}

export function getAcquisitionProgress(
  deps: UseCaseDeps,
  acquisitionId: string,
): DownloadProgress | undefined {
  return deps.progress.get(acquisitionId);
}
