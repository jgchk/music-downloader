import { describe, expect, it } from 'vitest';
import { asCandidateIdentity } from '../shared/__fixtures__/candidate-identity.js';
import { candidateQualityBucket, rankCandidates } from './ranking.js';
import type { Candidate, CandidateFile } from '../candidate/candidate.js';
import { createMatchPolicy, DEFAULT_MATCH_POLICY } from '../policy/policies.js';
import { createQualityPolicy, DEFAULT_QUALITY_POLICY } from '../policy/quality-policy.js';
import { createTarget } from '../target/target.js';
import type { Target } from '../target/target.js';

const target: Target = createTarget({
  type: 'album',
  artist: 'Radiohead',
  title: 'Kid A',
  year: 2000,
  tracks: [
    { position: 1, title: 'Everything in Its Right Place', durationMs: 251_000 },
    { position: 2, title: 'Kid A', durationMs: 264_000 },
  ],
})._unsafeUnwrap();

const alignedFiles: CandidateFile[] = [
  { name: '01 Everything in Its Right Place.flac', sizeBytes: 1, durationMs: 251_000 },
  { name: '02 Kid A.flac', sizeBytes: 1, durationMs: 264_000 },
];

function candidate(overrides: {
  username?: string;
  codec?: string;
  bitrate?: number;
  speed?: number;
  freeSlots?: number;
  queueLength?: number;
  files?: CandidateFile[];
  path?: string;
}): Candidate {
  const files = (overrides.files ?? alignedFiles).map((file) => ({
    ...file,
    codec: overrides.codec ?? file.codec,
    bitrate: overrides.bitrate ?? file.bitrate,
  }));
  return {
    identity: asCandidateIdentity({
      username: overrides.username ?? 'peer',
      path: overrides.path ?? 'Radiohead - Kid A (2000)',
      sizeBytes: 1000,
    }),
    files,
    source: {
      speedBytesPerSec: overrides.speed ?? 100,
      freeSlots: overrides.freeSlots ?? 1,
      queueLength: overrides.queueLength ?? 0,
    },
  };
}

describe('candidateQualityBucket', () => {
  it('resolves to the worst bucket among audio files', () => {
    const mixed = candidate({
      files: [
        { name: '01.flac', sizeBytes: 1, durationMs: 251_000, codec: 'flac' },
        { name: '02.mp3', sizeBytes: 1, durationMs: 264_000, codec: 'mp3', bitrate: 192_000 },
      ],
    });
    expect(candidateQualityBucket(mixed, DEFAULT_QUALITY_POLICY)).toBe('LOSSY_STANDARD');
  });

  it('is UNKNOWN when there are no audio files', () => {
    const c = candidate({ files: [{ name: 'cover.jpg', sizeBytes: 1 }] });
    expect(candidateQualityBucket(c, DEFAULT_QUALITY_POLICY)).toBe('UNKNOWN');
  });
});

describe('rankCandidates', () => {
  it('excludes candidates below the quality floor', () => {
    const losslessFloor = createQualityPolicy(
      DEFAULT_QUALITY_POLICY.order,
      'LOSSLESS',
    )._unsafeUnwrap();
    const lossy = candidate({ codec: 'mp3', bitrate: 320_000 });
    expect(rankCandidates([lossy], target, losslessFloor, DEFAULT_MATCH_POLICY)).toHaveLength(0);
  });

  it('excludes candidates below the match threshold', () => {
    const wrong = candidate({
      files: [{ name: 'unrelated.flac', sizeBytes: 1, durationMs: 5000 }],
    });
    const strict = createMatchPolicy(0.9)._unsafeUnwrap();
    expect(rankCandidates([wrong], target, DEFAULT_QUALITY_POLICY, strict)).toHaveLength(0);
  });

  it('ranks quality above a better match (spec scenario)', () => {
    const lossless = candidate({ username: 'a', codec: 'flac' });
    // A slightly weaker (fewer aligned) but still gate-passing lossy candidate.
    const lossy = candidate({ username: 'b', codec: 'mp3', bitrate: 320_000 });
    const ranked = rankCandidates(
      [lossy, lossless],
      target,
      DEFAULT_QUALITY_POLICY,
      DEFAULT_MATCH_POLICY,
    );
    expect(ranked[0]!.candidate.identity.username).toBe('a');
  });

  it('orders by match confidence within the same quality bucket', () => {
    const strong = candidate({ username: 'strong', codec: 'flac' });
    // Same lossless bucket and same aligned files, but its folder omits the year → the low-weight
    // year signal misses, giving a slightly lower (still gate-passing) match confidence.
    const weaker = candidate({ username: 'weaker', codec: 'flac', path: 'Radiohead - Kid A' });
    const ranked = rankCandidates(
      [weaker, strong],
      target,
      DEFAULT_QUALITY_POLICY,
      DEFAULT_MATCH_POLICY,
    );
    expect(ranked.map((r) => r.candidate.identity.username)).toEqual(['strong', 'weaker']);
  });

  it('breaks ties by source reliability then identity', () => {
    const fast = candidate({ username: 'fast', codec: 'flac', speed: 900 });
    const slow = candidate({ username: 'slow', codec: 'flac', speed: 100 });
    const ranked = rankCandidates(
      [slow, fast],
      target,
      DEFAULT_QUALITY_POLICY,
      DEFAULT_MATCH_POLICY,
    );
    expect(ranked[0]!.candidate.identity.username).toBe('fast');
  });

  it('breaks a full tie deterministically by identity key', () => {
    const a = candidate({ username: 'aaa', codec: 'flac' });
    const b = candidate({ username: 'bbb', codec: 'flac' });
    const ranked = rankCandidates([b, a], target, DEFAULT_QUALITY_POLICY, DEFAULT_MATCH_POLICY);
    expect(ranked.map((r) => r.candidate.identity.username)).toEqual(['aaa', 'bbb']);
  });

  it('uses free slots and queue length as finer source tie-breaks', () => {
    const roomy = candidate({ username: 'roomy', codec: 'flac', speed: 100, freeSlots: 5 });
    const busy = candidate({ username: 'busy', codec: 'flac', speed: 100, freeSlots: 0 });
    const short = candidate({
      username: 'short',
      codec: 'flac',
      speed: 100,
      freeSlots: 5,
      queueLength: 1,
    });
    const ranked = rankCandidates(
      [busy, short, roomy],
      target,
      DEFAULT_QUALITY_POLICY,
      DEFAULT_MATCH_POLICY,
    );
    expect(ranked.map((r) => r.candidate.identity.username)).toEqual(['roomy', 'short', 'busy']);
  });
});
