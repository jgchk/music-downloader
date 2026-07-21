/** Duration comparison shared by search-time matching and post-download validation. */

export const DURATION_TOLERANCE_MS = 5000;
export const DURATION_TOLERANCE_FRACTION = 0.04;

/** Two durations align when they differ by no more than the larger of an absolute and a relative bound. */
export function withinDurationTolerance(a: number, b: number): boolean {
  const tolerance = Math.max(DURATION_TOLERANCE_MS, a * DURATION_TOLERANCE_FRACTION);
  return Math.abs(a - b) <= tolerance;
}

/**
 * The fraction of `expected` durations that line up with an `actual` duration once both are
 * sorted. Comparing sorted lists is order-insensitive (tracks may be shuffled); an empty
 * expectation cannot be aligned and scores 0.
 */
export function alignmentScore(expected: readonly number[], actual: readonly number[]): number {
  if (expected.length === 0) return 0;
  const sortedExpected = [...expected].sort((x, y) => x - y);
  const sortedActual = [...actual].sort((x, y) => x - y);
  const pairs = Math.min(sortedExpected.length, sortedActual.length);
  let matches = 0;
  for (let i = 0; i < pairs; i += 1) {
    if (withinDurationTolerance(sortedExpected[i]!, sortedActual[i]!)) matches += 1;
  }
  return matches / expected.length;
}
