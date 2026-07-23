import { err, ok } from 'neverthrow';
import type { Result } from 'neverthrow';
import { branded } from '../shared/brand.js';
import type { Brand } from '../shared/brand.js';

/**
 * A source-agnostic candidate: one peer's copy of the target, already grouped to the
 * target's granularity by the SearchPort (D11). A fileset (folder) for a release, a single
 * file for a track. Advertised audio attributes are unreliable at search time — validation
 * (D5) inspects the actual bytes later.
 */

/**
 * Stable cross-round identity: `(username, path, size)` (D6). Drives dedup and the rejected-set —
 * so it is branded (compile-time only, runtime-erased) and can only be minted through
 * {@link parseCandidateIdentity}, which proves the key is sound before it ever seeds a Set/Map.
 * The value serializes on events as a plain object, unchanged.
 */
export type CandidateIdentity = Brand<
  {
    readonly username: string;
    readonly path: string;
    readonly sizeBytes: number;
  },
  'CandidateIdentity'
>;

/** The unvalidated shape a source reports, parsed at the adapter edge into a {@link CandidateIdentity}. */
export interface CandidateIdentityInput {
  readonly username: string;
  readonly path: string;
  readonly sizeBytes: number;
}

export type InvalidCandidateIdentity =
  | { readonly kind: 'EmptyUsername' }
  | { readonly kind: 'EmptyPath' }
  | { readonly kind: 'InvalidSize' };

/** Parse-don't-validate: reject a blank username/path or a negative/non-finite size at the edge. */
export function parseCandidateIdentity(
  input: CandidateIdentityInput,
): Result<CandidateIdentity, InvalidCandidateIdentity> {
  if (input.username.trim() === '') return err({ kind: 'EmptyUsername' });
  if (input.path.trim() === '') return err({ kind: 'EmptyPath' });
  if (!Number.isFinite(input.sizeBytes) || input.sizeBytes < 0) {
    return err({ kind: 'InvalidSize' });
  }
  return ok(
    branded<CandidateIdentity>({
      username: input.username,
      path: input.path,
      sizeBytes: input.sizeBytes,
    }),
  );
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

const KEY_SEPARATOR = '\u{0}';

/** A collision-resistant string key for a candidate identity, for use in Sets/Maps. */
export function candidateKey(identity: CandidateIdentity): string {
  return [identity.username, identity.path, String(identity.sizeBytes)].join(KEY_SEPARATOR);
}

export function isSameCandidate(a: CandidateIdentity, b: CandidateIdentity): boolean {
  return candidateKey(a) === candidateKey(b);
}

/**
 * A candidate reference as an external reporter names it: username and path are required, size is
 * corroborating detail the reporter may not have retained.
 */
export interface CandidateReference {
  readonly username: string;
  readonly path: string;
  readonly sizeBytes?: number;
}

/** Whether an external reference names this identity: username+path must match; size when given. */
export function isReferringTo(reference: CandidateReference, identity: CandidateIdentity): boolean {
  return (
    reference.username === identity.username &&
    reference.path === identity.path &&
    (reference.sizeBytes === undefined || reference.sizeBytes === identity.sizeBytes)
  );
}

export function fileCount(candidate: Candidate): number {
  return candidate.files.length;
}
