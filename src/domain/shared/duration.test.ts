import { describe, expect, it } from 'vitest';
import { alignmentScore, withinDurationTolerance } from './duration.js';

describe('withinDurationTolerance', () => {
  it('accepts small absolute differences', () => {
    expect(withinDurationTolerance(180000, 182000)).toBe(true);
  });

  it('accepts a relative difference on long tracks', () => {
    // 40 min track: 4% is 96s, so a 60s difference is within tolerance.
    expect(withinDurationTolerance(2_400_000, 2_460_000)).toBe(true);
  });

  it('rejects a large difference', () => {
    expect(withinDurationTolerance(180000, 200000)).toBe(false);
  });
});

describe('alignmentScore', () => {
  it('scores 1 when every expected duration lines up regardless of order', () => {
    expect(alignmentScore([300000, 100000, 200000], [200000, 300000, 100000])).toBe(1);
  });

  it('scores the aligned fraction on partial matches', () => {
    expect(alignmentScore([100000, 200000], [100000, 999999])).toBe(0.5);
  });

  it('scores 0 for an empty expectation', () => {
    expect(alignmentScore([], [100000])).toBe(0);
  });
});
