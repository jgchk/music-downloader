import { branded } from './brand.js';
import type { Brand } from './brand.js';

/**
 * A positive integer (≥ 1) — a track or disc number. Branded (compile-time only, runtime-erased) so
 * a bare `number` cannot stand in where the domain expects a real 1-based ordinal; the value still
 * serializes on events as a plain number, unchanged.
 *
 * Its invariant (`Number.isInteger && > 0`) is already proven by the boundary schema
 * (`z.number().int().positive()` on the manual-tags wire shape), so the value is *lifted* into the
 * brand by a trusted mint at the intake mapping rather than re-validated — a redundant `Result` would
 * carry a failure branch unreachable behind that schema.
 */
export type PositiveInt = Brand<number, 'PositiveInt'>;

/**
 * Lift a schema-validated ordinal into a {@link PositiveInt}. Trusted: call it only where the wire
 * schema has already proven the value a positive integer (the manual-tags intake mapping).
 */
export function toPositiveInt(value: number): PositiveInt {
  return branded<PositiveInt>(value);
}
