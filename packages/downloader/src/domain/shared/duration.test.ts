import { describe, expect, it } from 'vitest';
import { alignmentScore, isWithinDurationTolerance } from './duration.js';

describe('isWithinDurationTolerance', () => {
  it('accepts small absolute differences', () => {
    expect(isWithinDurationTolerance(180_000, 182_000)).toBe(true);
  });

  it('accepts a relative difference on long tracks', () => {
    // 40 min track: 4% is 96s, so a 60s difference is within tolerance.
    expect(isWithinDurationTolerance(2_400_000, 2_460_000)).toBe(true);
  });

  it('rejects a large difference', () => {
    expect(isWithinDurationTolerance(180_000, 200_000)).toBe(false);
  });
});

describe('alignmentScore', () => {
  it('scores 1 when every expected duration lines up regardless of order', () => {
    expect(alignmentScore([300_000, 100_000, 200_000], [200_000, 300_000, 100_000])).toBe(1);
  });

  it('scores the aligned fraction on partial matches', () => {
    expect(alignmentScore([100_000, 200_000], [100_000, 999_999])).toBe(0.5);
  });

  it('scores 0 for an empty expectation', () => {
    expect(alignmentScore([], [100_000])).toBe(0);
  });
});
