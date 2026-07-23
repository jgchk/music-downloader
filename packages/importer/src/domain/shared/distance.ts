import { err, ok } from 'neverthrow';
import type { Result } from 'neverthrow';
import { branded } from './brand.js';
import type { Brand } from './brand.js';

/**
 * A beets match distance: a scalar in the closed unit interval [0, 1] where 0 is a perfect match.
 * Branded (compile-time only, runtime-erased) because the auto-apply routing turns on
 * `distance > threshold` — a `NaN` or out-of-range value would silently misroute. Parsing at the
 * edge guarantees every distance the domain compares is finite and in range. The value still
 * serializes on events as a plain number, unchanged.
 */
export type Distance = Brand<number, 'Distance'>;

export type InvalidDistance = { readonly kind: 'InvalidDistance'; readonly value: number };

/** Parse-don't-validate: a finite in-range number becomes a {@link Distance}, anything else an error. */
export function parseDistance(value: number): Result<Distance, InvalidDistance> {
  if (!Number.isFinite(value) || value < 0 || value > 1) {
    return err({ kind: 'InvalidDistance', value });
  }
  return ok(branded<Distance>(value));
}
