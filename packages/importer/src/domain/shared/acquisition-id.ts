import { branded } from './brand.js';
import type { Brand } from './brand.js';

/**
 * The downloader's acquisition identifier as it crosses the intake anti-corruption boundary — a
 * foreign id the importer records for durable convergence, never one it mints. Branded (compile-time
 * only, runtime-erased) so it can never be transposed with the importer's own {@link ImportId} at
 * their junction (`importIdForAcquisition`): the two are the same shape but not interchangeable.
 *
 * Its only invariant is "a non-empty string", which the seam schema (`contracts/intake`) already
 * proves at the edge — so the value is *lifted* into the brand by a trusted mint, not re-validated
 * (a redundant `Result` would carry an unreachable failure). The id still serializes as a plain
 * string on events, unchanged.
 */
export type AcquisitionId = Brand<string, 'AcquisitionId'>;

/**
 * Lift a seam-validated acquisition id into an {@link AcquisitionId}. Trusted: call it only where the
 * intake schema has already proven the value a non-empty string (the intake ACL mapping).
 */
export function toAcquisitionId(value: string): AcquisitionId {
  return branded<AcquisitionId>(value);
}
