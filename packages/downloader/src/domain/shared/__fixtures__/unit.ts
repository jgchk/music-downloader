import { branded } from '../brand.js';
import type { Unit } from '../unit.js';

/**
 * Brand an arbitrary number as a {@link Unit} for tests. Range validity is an edge/construction
 * concern (production mints via `parseUnit`/`clampUnit`); tests that exercise the domain just need
 * *some* unit-scalar stimulus, so they mint one directly — including deliberately out-of-range
 * values the domain type otherwise forbids.
 */
export function asUnit(value: number): Unit {
  return branded<Unit>(value);
}
