/**
 * A source-agnostic candidate: one peer's copy of the target, already grouped to the
 * target's granularity by the SearchPort (D11). A fileset (folder) for a release, a single
 * file for a track. Advertised audio attributes are unreliable at search time — validation
 * (D5) inspects the actual bytes later.
 */

/** Stable cross-round identity: `(username, path, size)` (D6). Drives dedup and the rejected-set. */
export interface CandidateIdentity {
  readonly username: string;
  readonly path: string;
  readonly sizeBytes: number;
}

export interface CandidateFile {
  readonly name: string;
  readonly sizeBytes: number;
  readonly codec?: string;
  readonly bitrate?: number; // bits per second
  readonly sampleRate?: number; // Hz
  readonly bitDepth?: number; // bits per sample
  readonly durationMs?: number;
}

/** Source reliability signals used only as the final ranking tie-break (D11). */
export interface SourceReliability {
  readonly speedBytesPerSec: number;
  readonly freeSlots: number;
  readonly queueLength: number;
}

export interface Candidate {
  readonly identity: CandidateIdentity;
  readonly files: readonly CandidateFile[];
  readonly source: SourceReliability;
}

const KEY_SEPARATOR = '\u0000';

/** A collision-resistant string key for a candidate identity, for use in Sets/Maps. */
export function candidateKey(identity: CandidateIdentity): string {
  return [identity.username, identity.path, String(identity.sizeBytes)].join(KEY_SEPARATOR);
}

export function sameCandidate(a: CandidateIdentity, b: CandidateIdentity): boolean {
  return candidateKey(a) === candidateKey(b);
}

/**
 * A candidate reference as an external reporter names it: username and path are required, size is
 * corroborating detail the reporter may not have retained.
 */
export interface CandidateRef {
  readonly username: string;
  readonly path: string;
  readonly sizeBytes?: number;
}

/** Whether an external reference names this identity: username+path must match; size when given. */
export function refersTo(ref: CandidateRef, identity: CandidateIdentity): boolean {
  return (
    ref.username === identity.username &&
    ref.path === identity.path &&
    (ref.sizeBytes === undefined || ref.sizeBytes === identity.sizeBytes)
  );
}

export function fileCount(candidate: Candidate): number {
  return candidate.files.length;
}
