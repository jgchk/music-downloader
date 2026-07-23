import { branded } from '../brand.js';
import type { Distance } from '../distance.js';

/**
 * Brand an arbitrary number as a {@link Distance} for tests. Range validity is an edge concern (the
 * beets adapter/config parse it); tests that exercise the domain just need *some* distance, so they
 * mint one directly without threading a parse Result through every fixture.
 */
export function asDistance(value: number): Distance {
  return branded<Distance>(value);
}
