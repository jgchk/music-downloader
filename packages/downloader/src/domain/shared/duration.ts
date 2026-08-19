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
  const aligned = sortedExpected.filter((expectedMs, index) => {
    // An expectation with no counterpart track — the release is short of the target — aligns with
    // nothing. Pairing by position over the sorted lists makes the shorter list the bound.
    const actualMs = sortedActual[index];
    // Stryker recorded-survivor ConditionalExpression `true`: equivalent — this is the
    // `actualMs !== undefined` operand, the narrowing that lets a possibly-absent element reach a
    // `(number, number)` comparison. Forced true, a missing counterpart reaches
    // `isWithinDurationTolerance(expectedMs, undefined)`, whose `Math.abs(a - undefined)` is `NaN`
    // and whose `NaN <= tolerance` is false — so the expectation is dropped from `aligned` either
    // way and the score is identical. Waived per mutant, not per line: the whole conjunction forced
    // true (every expectation aligns, so a release short of the target scores 1) and forced false
    // (nothing ever aligns) are both real findings, under this same mutator on this same line.
    return actualMs !== undefined && isWithinDurationTolerance(expectedMs, actualMs);
  });
  return aligned.length / expected.length;
}
