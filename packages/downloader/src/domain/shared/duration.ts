/** Duration comparison shared by search-time matching and post-download validation. */

export const DURATION_TOLERANCE_MS = 5000;
export const DURATION_TOLERANCE_FRACTION = 0.04;

/** Two durations align when they differ by no more than the larger of an absolute and a relative bound. */
export function isWithinDurationTolerance(a: number, b: number): boolean {
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
  const sortedExpected = expected.toSorted((x, y) => x - y);
  const sortedActual = actual.toSorted((x, y) => x - y);
  const pairs = Math.min(sortedExpected.length, sortedActual.length);
  let matches = 0;
  for (let index = 0; index < pairs; index += 1) {
    if (isWithinDurationTolerance(sortedExpected[index]!, sortedActual[index]!)) matches += 1;
  }
  return matches / expected.length;
}
