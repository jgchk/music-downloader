import { describe, expect, it } from 'vitest';
import {
  bucketRank,
  compareQuality,
  createQualityPolicy,
  DEFAULT_QUALITY_POLICY,
  isFloorMet,
  resolveQualityBucket,
} from './quality-policy.js';

describe('resolveQualityBucket', () => {
  it('classifies hi-res lossless by bit depth', () => {
    expect(resolveQualityBucket({ codec: 'flac', bitDepth: 24, sampleRate: 96_000 })).toBe(
      'LOSSLESS_HIRES',
    );
  });

  it('classifies hi-res lossless by sample rate alone', () => {
    expect(resolveQualityBucket({ codec: 'flac', bitDepth: 16, sampleRate: 96_000 })).toBe(
      'LOSSLESS_HIRES',
    );
  });

  it('classifies standard-resolution lossless, defaulting unknown depth/rate', () => {
    expect(resolveQualityBucket({ codec: 'flac' })).toBe('LOSSLESS');
  });

  it('recognizes lossless codecs beyond FLAC', () => {
    expect(resolveQualityBucket({ codec: 'ALAC' })).toBe('LOSSLESS');
  });

  it('honours an explicit lossless=false even for a lossless codec name', () => {
    expect(resolveQualityBucket({ codec: 'flac', lossless: false, bitrate: 300_000 })).toBe(
      'LOSSY_HIGH',
    );
  });

  it('returns UNKNOWN when there is no codec and no lossless hint', () => {
    expect(resolveQualityBucket({ codec: '' })).toBe('UNKNOWN');
  });

  it('returns UNKNOWN for a lossy codec with no bitrate', () => {
    expect(resolveQualityBucket({ codec: 'mp3' })).toBe('UNKNOWN');
  });

  it('buckets lossy audio by bitrate thresholds', () => {
    expect(resolveQualityBucket({ codec: 'mp3', bitrate: 320_000 })).toBe('LOSSY_HIGH');
    expect(resolveQualityBucket({ codec: 'mp3', bitrate: 192_000 })).toBe('LOSSY_STANDARD');
    expect(resolveQualityBucket({ codec: 'mp3', bitrate: 96_000 })).toBe('LOSSY_LOW');
  });
});

describe('createQualityPolicy', () => {
  it('accepts a non-empty order whose floor is present', () => {
    const result = createQualityPolicy(['LOSSLESS', 'LOSSY_HIGH'], 'LOSSY_HIGH');
    expect(result._unsafeUnwrap().floor).toBe('LOSSY_HIGH');
  });

  it('rejects an empty order', () => {
    expect(createQualityPolicy([], 'LOSSLESS')._unsafeUnwrapErr()).toEqual({ kind: 'EmptyOrder' });
  });

  it('rejects a floor that is not in the order', () => {
    expect(createQualityPolicy(['LOSSLESS'], 'LOSSY_LOW')._unsafeUnwrapErr()).toEqual({
      kind: 'FloorNotInOrder',
    });
  });
});

describe('bucketRank / isFloorMet / compareQuality', () => {
  const policy = DEFAULT_QUALITY_POLICY;

  it('ranks by position, with absent buckets worst', () => {
    expect(bucketRank(policy, 'LOSSLESS_HIRES')).toBe(0);
    expect(
      bucketRank(createQualityPolicy(['LOSSLESS'], 'LOSSLESS')._unsafeUnwrap(), 'UNKNOWN'),
    ).toBe(Infinity);
  });

  it('admits buckets at or above the floor and excludes those below', () => {
    expect(isFloorMet(policy, 'LOSSLESS')).toBe(true);
    expect(isFloorMet(policy, 'LOSSY_LOW')).toBe(true);
    expect(isFloorMet(policy, 'UNKNOWN')).toBe(false);
  });

  it('orders higher quality first', () => {
    expect(compareQuality(policy, 'LOSSLESS', 'LOSSY_LOW')).toBeLessThan(0);
    expect(compareQuality(policy, 'LOSSY_LOW', 'LOSSLESS')).toBeGreaterThan(0);
  });
});
