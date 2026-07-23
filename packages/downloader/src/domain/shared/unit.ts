import { err, ok } from 'neverthrow';
import type { Result } from 'neverthrow';
import { branded } from './brand.js';
import type { Brand } from './brand.js';

/**
 * A scalar in the closed unit interval [0, 1] — a confidence, a match score, or a signal weight.
 * Branded (compile-time only, runtime-erased) so a bare `number` cannot stand in for a value the
 * matching/validation/ranking code trusts to be in range: an out-of-range or `NaN` confidence would
 * silently misorder the walk or misroute the auto-apply gate. The value serializes on events as a
 * plain number, unchanged.
 *
 * Two sanctioned mints, mirroring how {@link Distance} is minted: {@link parseUnit} at an untrusted
 * edge (config/authored input — reject out of range) and {@link clampUnit} for a value the domain
 * computes and bounds by construction (a weighted mean, a `Math.min`).
 */
export type Unit = Brand<number, 'Unit'>;

export type OutOfUnitRange = { readonly kind: 'OutOfUnitRange'; readonly value: number };

/** Parse-don't-validate: a finite in-range number becomes a {@link Unit}, anything else an error. */
export function parseUnit(value: number): Result<Unit, OutOfUnitRange> {
  if (!Number.isFinite(value) || value < 0 || value > 1) {
    return err({ kind: 'OutOfUnitRange', value });
  }
  return ok(branded<Unit>(value));
}

/**
 * Mint a {@link Unit} from a value the domain computed and already bounds to [0, 1] by construction
 * (a weighted mean of Units, a `Math.min` of Units), pinning any floating-point overshoot to the
 * nearest bound. Use this — not {@link parseUnit} — where a range violation would be a domain bug,
 * not authored input to reject.
 */
export function clampUnit(value: number): Unit {
  return branded<Unit>(Math.min(1, Math.max(0, value)));
}
