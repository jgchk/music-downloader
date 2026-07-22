import type { ResultAsync } from 'neverthrow';
import type { Candidate } from '../../domain/candidate/candidate.js';
import type { DownloadPolicy } from '../../domain/policy/policies.js';
import type { Target } from '../../domain/target/target.js';
import type { ProbedAudio } from '../../domain/validation/validators.js';
import type {
  AcquisitionRequest,
  DownloadFailureReason,
  DownloadedFile,
  EditionCandidate,
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
  | { readonly kind: 'resolved'; readonly target: Target }
  | { readonly kind: 'unresolved' } // no confident match — a business fact, not an infra fault
  // a release group with editions but no official one: a human must choose (manual-edition-selection)
  | { readonly kind: 'needsSelection'; readonly candidates: readonly EditionCandidate[] };

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
  | {
      readonly kind: 'failed';
      readonly reason: DownloadFailureReason;
      // Files the source had already completed into staging before the candidate was abandoned or
      // doomed. Threaded through the domain so staging-cleanup removes them (design D2); best-effort,
      // so an unresolvable subset simply yields none rather than failing the outcome (D3).
      readonly files?: readonly DownloadedFile[];
    };

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
   *
   * Returns the files the source had already completed into staging before the abort, so the caller
   * can thread them into the settlement for staging-cleanup (design D2). Best-effort: an unresolvable
   * subset yields none rather than failing the abort (D3).
   */
  abort(
    acquisitionId: string,
    candidate: Candidate,
  ): ResultAsync<readonly DownloadedFile[], InfraError>;
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
  /**
   * Remove the given staged files so only valid music reaches the library (D13), and prune their
   * now-emptied staging directory. The files are the source-reported staged locations, carried on
   * the cleanup-triggering event (D3), so cleanup never recomputes a path from candidate identity.
   */
  discardStaging(files: readonly DownloadedFile[]): ResultAsync<void, InfraError>;
}
