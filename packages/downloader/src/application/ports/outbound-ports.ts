import type { ResultAsync } from 'neverthrow';
import type { Candidate, CandidateIdentity } from '../../domain/candidate/candidate.js';
import type { TryPolicy } from '../../domain/policy/policies.js';
import type { Target } from '../../domain/target/target.js';
import type { ProbedAudio } from '../../domain/validation/validators.js';
import type {
  DownloadRequest,
  TryFailureReason,
  DownloadedFile,
  EditionCandidate,
} from '../../domain/download/events.js';
import type { CommandContext, OperationScope } from '../correlation/context.js';
import type { InfraError } from './errors.js';

/**
 * The outbound ports (D2/D9): narrow, per-concern interfaces the application depends on and
 * adapters implement (DIP + ISP). Every method returns a neverthrow `ResultAsync` whose `Err`
 * channel is an {@link InfraError}; *business* outcomes (unresolved metadata, a failed transfer,
 * an import conflict) are modeled as `Ok` values so `decide` can turn them into domain events.
 *
 * Every OUTBOUND effect method takes the dispatching {@link OperationScope} as its LAST parameter —
 * one uniform rule, so there is no per-port exception to remember and the compiler catches a call
 * site that forgot. {@link TransferObserverPort} is the exception because it is not an effect: it
 * is the INBOUND half, implemented by the application, so `outcome` takes the pinned
 * {@link CommandContext} to carry back into the shell and the fire-and-forget notifications take
 * neither. An adapter uses `scope.logger` (already bound to the operation, so its lines join
 * the download without the adapter knowing what correlation is) and carries `scope.context`
 * opaquely wherever it re-enters the shell asynchronously. No adapter reads a field of either.
 */

// --- MetadataPort (first adapter: MusicBrainz) -------------------------------------------------

export type MetadataResolution =
  | { readonly kind: 'resolved'; readonly target: Target }
  | { readonly kind: 'unresolved' } // no confident match — a business fact, not an infra fault
  // a release group with editions but no official one: a human must choose (manual-edition-selection)
  | { readonly kind: 'needsSelection'; readonly candidates: readonly EditionCandidate[] };

export interface MetadataPort {
  resolve(
    request: DownloadRequest,
    scope: OperationScope,
  ): ResultAsync<MetadataResolution, InfraError>;
}

// --- SearchPort (first adapter: slskd) ---------------------------------------------------------

export interface SearchPort {
  /**
   * Returns candidates already grouped to the target's granularity; empty is a valid result. The
   * `acquisitionId` owns any source-side search resource created, so it can be recorded in the
   * ownership ledger and cleaned up after the results are harvested.
   */
  search(
    acquisitionId: string,
    target: Target,
    round: number,
    scope: OperationScope,
  ): ResultAsync<readonly Candidate[], InfraError>;
}

// --- TransferPort (first adapter: slskd) -------------------------------------------------------

export interface TransferProgress {
  readonly percent: number;
  readonly bytesTransferred: number;
  readonly bytesTotal: number;
  readonly queuePosition?: number;
}

export type TryResult =
  | { readonly kind: 'completed'; readonly files: readonly DownloadedFile[] }
  | {
      readonly kind: 'failed';
      readonly reason: TryFailureReason;
      // Files the source had already completed into staging before the candidate was abandoned or
      // doomed. Threaded through the domain so staging-cleanup removes them (design D2); best-effort,
      // so an unresolvable subset simply yields none rather than failing the outcome (D3).
      readonly files?: readonly DownloadedFile[];
    };

/** Start's synchronous answer: the source accepted the enqueue, or refused THIS candidate. */
export type TryStart =
  { readonly kind: 'started' } | { readonly kind: 'rejected'; readonly reason: TryFailureReason };

/**
 * The application-owned face the transfer supervisor reports through
 * (nonblocking-download-observation D1/D2; progress stays ephemeral per D4): live progress
 * ticks, the single candidate-level outcome fact once the watch settles, and the watch's end
 * (so ephemeral progress is retired).
 * Implemented by the application, injected into the adapter at composition — the inbound half of
 * the download conversation, mirroring how another context's verdicts are consumed.
 */
export interface TransferObserverPort {
  progress(acquisitionId: string, progress: TransferProgress): void;
  /**
   * Deliver the settled outcome, named with the candidate it settles (the consumer threads it
   * into the decision path's late-report guard). An `Err` means the delivery could not land
   * (infrastructure); the supervisor retries on its cadence. Domain-level staleness is the
   * consumer's to absorb — it resolves `Ok` for an outcome it recorded-and-skipped.
   */
  outcome(
    acquisitionId: string,
    candidate: CandidateIdentity,
    result: TryResult,
    context: CommandContext,
  ): ResultAsync<void, InfraError>;
  /**
   * Every watch for the download has ended — settled, or aborted. Live progress for the
   * download is retired.
   */
  finished(acquisitionId: string): void;
}

export interface TransferPort {
  /**
   * Ensure the candidate is enqueued at the source and being watched
   * (nonblocking-download-observation D1): reconcile/re-attach against the ownership ledger,
   * enqueue when the source holds nothing, register the watch, and return promptly. Idempotent —
   * starting an already-watched candidate is a no-op answer of `started`, which is what lets the
   * reactor re-dispatch it level-triggered (live redelivery and startup re-drive alike). The
   * outcome arrives later through the {@link TransferObserverPort}; only an enqueue the source
   * itself refused is answered synchronously as `rejected`.
   */
  start(
    acquisitionId: string,
    candidate: Candidate,
    policy: TryPolicy,
    scope: OperationScope,
  ): ResultAsync<TryStart, InfraError>;

  /**
   * Cancel a candidate's in-flight transfers at the source and remove their records, so a cancelled
   * download stops downloading rather than running to completion (D: cancellation). Ends the
   * candidate's watch promptly — no outcome is emitted for an aborted candidate; the abort's own
   * settlement (this method's return, fed back as a command) owns the cleanup. Idempotent:
   * transfers already settled or absent are tolerated, so a redelivered abort is safe. The
   * `acquisitionId` scopes the transfers to the ones this download owns in the ledger.
   *
   * Returns the files the source had already completed into staging before the abort, so the caller
   * can thread them into the settlement for staging-cleanup (design D2). Best-effort: an unresolvable
   * subset yields none rather than failing the abort (D3).
   */
  abort(
    acquisitionId: string,
    candidate: Candidate,
    scope: OperationScope,
  ): ResultAsync<readonly DownloadedFile[], InfraError>;
}

// --- AudioProbePort (first adapter: ffmpeg) ----------------------------------------------------

export interface AudioProbePort {
  probe(filePath: string, scope: OperationScope): ResultAsync<ProbedAudio, InfraError>;
}

// --- LibraryPort (first adapter: filesystem) ---------------------------------------------------

export type ImportResult =
  | { readonly kind: 'imported'; readonly location: string }
  | { readonly kind: 'conflict'; readonly location: string };

export interface LibraryPort {
  import(
    files: readonly DownloadedFile[],
    target: Target,
    scope: OperationScope,
  ): ResultAsync<ImportResult, InfraError>;
  /**
   * Remove the given staged files so only valid music reaches the library (D13), and prune their
   * now-emptied staging directory. The files are the source-reported staged locations, carried on
   * the cleanup-triggering event (D3), so cleanup never recomputes a path from candidate identity.
   */
  discardStaging(
    files: readonly DownloadedFile[],
    scope: OperationScope,
  ): ResultAsync<void, InfraError>;
}
