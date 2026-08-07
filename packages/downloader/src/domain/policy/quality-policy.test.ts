import { describe, expect, it } from 'vitest';
import {
  bucketRank,
  compareQuality,
  createQualityPolicy,
  DEFAULT_QUALITY_POLICY,
  isFloorMet,
  QUALITY_BUCKETS,
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

  // The lossless set IS the policy (D5: reason about the probed codec, not the file extension), so
  // every member of it is a behavioral claim. Two members used to be exercised and nine were
  // effectively decorative: dropping `aiff` or `wavpack` from the set changed no test's verdict,
  // which is the same as not having decided they are lossless at all.
  it.each(['flac', 'alac', 'wav', 'wave', 'aiff', 'aif', 'ape', 'wavpack', 'wv', 'tak', 'tta'])(
    'treats %s as lossless',
    (codec) => {
      expect(resolveQualityBucket({ codec })).toBe('LOSSLESS');
    },
  );

  it('classifies hi-res lossless by bit depth alone, at standard sample rate', () => {
    // The companion to 'by sample rate alone'. Without it, the two hi-res conditions were only ever
    // satisfied together, so neither had to be doing any work.
    expect(resolveQualityBucket({ codec: 'flac', bitDepth: 24, sampleRate: 44_100 })).toBe(
      'LOSSLESS_HIRES',
    );
  });

  it('reads the codec through surrounding whitespace and case', () => {
    expect(resolveQualityBucket({ codec: '  FLAC  ' })).toBe('LOSSLESS');
  });

  it('buckets by bitrate when the codec is unknown but the item is declared lossy', () => {
    // Codec absent, but `lossless: false` is a hint in its own right: the bitrate still decides.
    // Reading this as UNKNOWN would throw away the one measurement available.
    expect(resolveQualityBucket({ codec: '', lossless: false, bitrate: 300_000 })).toBe(
      'LOSSY_HIGH',
    );
  });

  it('honours an explicit lossless=false even for a lossless codec name', () => {
    expect(resolveQualityBucket({ codec: 'flac', lossless: false, bitrate: 300_000 })).toBe(
      'LOSSY_HIGH',
    );
  });

  it('returns UNKNOWN when there is no codec and no lossless hint', () => {
    expect(resolveQualityBucket({ codec: '' })).toBe('UNKNOWN');
  });

  it('returns UNKNOWN when there is no codec and no hint, even with a bitrate to hand', () => {
    // The existing no-codec case reaches UNKNOWN by the *other* route (no bitrate), so the guard
    // at the top of the lossy path was never the thing deciding. A bitrate present makes it decide.
    expect(resolveQualityBucket({ codec: '', bitrate: 300_000 })).toBe('UNKNOWN');
  });

  it('returns UNKNOWN for a lossy codec with no bitrate', () => {
    expect(resolveQualityBucket({ codec: 'mp3' })).toBe('UNKNOWN');
  });

  it('buckets lossy audio by bitrate thresholds', () => {
    expect(resolveQualityBucket({ codec: 'mp3', bitrate: 320_000 })).toBe('LOSSY_HIGH');
    expect(resolveQualityBucket({ codec: 'mp3', bitrate: 192_000 })).toBe('LOSSY_STANDARD');
    expect(resolveQualityBucket({ codec: 'mp3', bitrate: 96_000 })).toBe('LOSSY_LOW');
  });

  // Both thresholds are inclusive, and only a test *at* the threshold says so. Sampling either side
  // of it leaves `>=` and `>` indistinguishable — the classic off-by-one that no amount of coverage
  // can see, because both operators execute the same line.
  it('admits a bitrate exactly at a threshold into the better bucket', () => {
    expect(resolveQualityBucket({ codec: 'mp3', bitrate: 256_000 })).toBe('LOSSY_HIGH');
    expect(resolveQualityBucket({ codec: 'mp3', bitrate: 128_000 })).toBe('LOSSY_STANDARD');
  });

  it('drops a bitrate one bit below a threshold into the worse bucket', () => {
    expect(resolveQualityBucket({ codec: 'mp3', bitrate: 255_999 })).toBe('LOSSY_STANDARD');
    expect(resolveQualityBucket({ codec: 'mp3', bitrate: 127_999 })).toBe('LOSSY_LOW');
  });
});

describe('QUALITY_BUCKETS', () => {
  // Asserted through the behaviour the order exists for, with the pairs written out rather than
  // derived from the constant. Deriving them made the test tautological: `compareQuality` ranks by
  // `indexOf` into the very same list, so every pair reduced to `i - (i+1) < 0` and any permutation
  // stayed green. Spelling the pairs out is Evident Data — it can actually fail.
  it.each([
    ['LOSSLESS_HIRES', 'LOSSLESS'],
    ['LOSSLESS', 'LOSSY_HIGH'],
    ['LOSSY_HIGH', 'LOSSY_STANDARD'],
    ['LOSSY_STANDARD', 'LOSSY_LOW'],
    ['LOSSY_LOW', 'UNKNOWN'],
  ] as const)('ranks %s above %s', (better, worse) => {
    expect(compareQuality(DEFAULT_QUALITY_POLICY, better, worse)).toBeLessThan(0);
  });

  it('admits every tier except UNKNOWN under the default floor', () => {
    // The floor fact the ordering rests on: UNKNOWN is the one bucket the default policy excludes.
    expect(isFloorMet(DEFAULT_QUALITY_POLICY, 'LOSSY_LOW')).toBe(true);
    expect(isFloorMet(DEFAULT_QUALITY_POLICY, 'UNKNOWN')).toBe(false);
    expect(QUALITY_BUCKETS).toHaveLength(6);
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
