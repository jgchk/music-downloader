import type { ResultAsync } from 'neverthrow';
import type { Candidate, CandidateIdentity } from '../../domain/candidate/candidate.js';
import type { DownloadPolicy } from '../../domain/policy/policies.js';
import type { Target } from '../../domain/target/target.js';
import type { ProbedAudio } from '../../domain/validation/validators.js';
import type {
  AcquisitionRequest,
  DownloadFailureReason,
  DownloadedFile,
} from '../../domain/acquisition/events.js';
import type { InfraError } from './errors.js';

/**
 * The outbound ports (D2/D9): narrow, per-concern interfaces the application depends on and
 * adapters implement (DIP + ISP). Every method returns a neverthrow `ResultAsync` whose `Err`
 * channel is an {@link InfraError}; *business* outcomes (unresolved metadata, a failed transfer,
 * an import conflict) are modeled as `Ok` values so `decide` can turn them into domain events.
 */

// --- MetadataPort (first adapter: MusicBrainz) -------------------------------------------------

export type MetadataResolution =
  { readonly kind: 'resolved'; readonly target: Target } | { readonly kind: 'unresolved' }; // no confident match — a business fact, not an infra fault

export interface MetadataPort {
  resolve(request: AcquisitionRequest): ResultAsync<MetadataResolution, InfraError>;
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
  ): ResultAsync<readonly Candidate[], InfraError>;
}

// --- DownloadPort (first adapter: slskd) -------------------------------------------------------

export interface DownloadProgress {
  readonly percent: number;
  readonly bytesTransferred: number;
  readonly bytesTotal: number;
  readonly queuePosition?: number;
}

export type DownloadResult =
  | { readonly kind: 'completed'; readonly files: readonly DownloadedFile[] }
  | { readonly kind: 'failed'; readonly reason: DownloadFailureReason };

export interface DownloadPort {
  download(
    acquisitionId: string,
    candidate: Candidate,
    policy: DownloadPolicy,
    onProgress: (progress: DownloadProgress) => void,
  ): ResultAsync<DownloadResult, InfraError>;

  /**
   * Cancel a candidate's in-flight transfers at the source and remove their records, so a cancelled
   * acquisition stops downloading rather than running to completion (D: cancellation). Idempotent:
   * transfers already settled or absent are tolerated, so a redelivered abort is safe. The
   * `acquisitionId` scopes the transfers to the ones this acquisition owns in the ledger.
   */
  abort(acquisitionId: string, candidate: Candidate): ResultAsync<void, InfraError>;
}

// --- AudioProbePort (first adapter: ffmpeg) ----------------------------------------------------

export interface AudioProbePort {
  probe(filePath: string): ResultAsync<ProbedAudio, InfraError>;
}

// --- LibraryPort (first adapter: filesystem) ---------------------------------------------------

export type ImportResult =
  | { readonly kind: 'imported'; readonly location: string }
  | { readonly kind: 'conflict'; readonly location: string };

export interface LibraryPort {
  import(files: readonly DownloadedFile[], target: Target): ResultAsync<ImportResult, InfraError>;
  /** Remove a rejected candidate's staged files so only valid music reaches the library (D13). */
  discardStaging(candidate: CandidateIdentity): ResultAsync<void, InfraError>;
}
