import type { ResultAsync } from 'neverthrow';
import type { AcquisitionRequest } from '../../domain/acquisition/events.js';
import type { CandidateRef } from '../../domain/candidate/candidate.js';
import type { AcquisitionPolicies } from '../../domain/policy/policies.js';
import type { DownloadProgress } from '../ports/outbound-ports.js';
import type { IdGenerator } from '../ports/system-ports.js';
import type {
  AcquisitionStatusProjection,
  AcquisitionStatusView,
  ProgressReadModel,
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

/** What an external adjudicator reported about a delivered candidate (fulfillment-external-verdict). */
export interface ExternalValidationFailureInput {
  readonly candidate: CandidateRef;
  readonly reasons: readonly string[];
}

/**
 * Record an external validation failure against an acquisition. `decide` is the single guard: a
 * matching verdict on a revivable fulfilment revives the retry ladder; anything stale, mismatched,
 * or redelivered converges to a no-op — never an error — so webhook redelivery is safe end-to-end.
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

export function getAcquisition(
  deps: UseCaseDeps,
  acquisitionId: string,
): AcquisitionStatusView | undefined {
  return deps.status.get(acquisitionId);
}

export function listAcquisitions(deps: UseCaseDeps): readonly AcquisitionStatusView[] {
  return deps.status.list();
}

export function getAcquisitionProgress(
  deps: UseCaseDeps,
  acquisitionId: string,
): DownloadProgress | undefined {
  return deps.progress.get(acquisitionId);
}
