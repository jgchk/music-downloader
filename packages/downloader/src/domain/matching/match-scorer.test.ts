import { describe, expect, it } from 'vitest';
import { asCandidateIdentity } from '../shared/__fixtures__/candidate-identity.js';
import {
  audioFiles,
  candidateText,
  durationSignal,
  isAudioFile,
  scoreMatch,
  trackCountSignal,
  yearSignal,
} from './match-scorer.js';
import type { Candidate } from '../candidate/candidate.js';
import { createTarget } from '../target/target.js';
import type { Target } from '../target/target.js';

const target: Target = createTarget({
  type: 'album',
  artist: 'Portishead',
  title: 'Dummy',
  year: 1994,
  tracks: [
    { position: 1, title: 'Mysterons', durationMs: 300_000 },
    { position: 2, title: 'Sour Times', durationMs: 250_000 },
    { position: 3, title: 'Strangers', durationMs: 240_000 },
  ],
})._unsafeUnwrap();

function candidate(
  files: Candidate['files'],
  path = 'Portishead - Dummy (1994) [FLAC]',
): Candidate {
  return {
    identity: asCandidateIdentity({ username: 'peer', path, sizeBytes: 1000 }),
    files,
    source: { speedBytesPerSec: 1, freeSlots: 1, queueLength: 0 },
  };
}

describe('isAudioFile / audioFiles', () => {
  it('detects audio by codec, duration, or extension and ignores other files', () => {
    expect(isAudioFile({ name: 'a.flac', sizeBytes: 1 })).toBe(true);
    expect(isAudioFile({ name: 'noext', sizeBytes: 1, codec: 'flac' })).toBe(true);
    expect(isAudioFile({ name: 'noext', sizeBytes: 1, durationMs: 1000 })).toBe(true);
    expect(isAudioFile({ name: 'cover.jpg', sizeBytes: 1 })).toBe(false);
    expect(isAudioFile({ name: 'README', sizeBytes: 1 })).toBe(false);
  });

  it('filters a candidate to its audio files', () => {
    const c = candidate([
      { name: '01.flac', sizeBytes: 1 },
      { name: 'folder.jpg', sizeBytes: 1 },
    ]);
    expect(audioFiles(c)).toHaveLength(1);
  });
});

describe('candidateText', () => {
  it('combines the folder basename and file names, normalized', () => {
    const c = candidate([{ name: '01 - Mysterons.flac', sizeBytes: 1 }], '/downloads/Portishead');
    expect(candidateText(c)).toContain('portishead');
    expect(candidateText(c)).toContain('mysterons');
  });
});

describe('scoreMatch', () => {
  it('gives a structurally-matching candidate high confidence', () => {
    const good = candidate([
      { name: '01.flac', sizeBytes: 1, durationMs: 300_000 },
      { name: '02.flac', sizeBytes: 1, durationMs: 250_000 },
      { name: '03.flac', sizeBytes: 1, durationMs: 240_000 },
    ]);
    expect(scoreMatch(target, good)).toBeGreaterThan(0.9);
  });

  it('ranks a full, aligned fileset above a short one (spec scenario)', () => {
    const full = candidate([
      { name: '01.flac', sizeBytes: 1, durationMs: 300_000 },
      { name: '02.flac', sizeBytes: 1, durationMs: 250_000 },
      { name: '03.flac', sizeBytes: 1, durationMs: 240_000 },
    ]);
    const short = candidate([{ name: '01.flac', sizeBytes: 1, durationMs: 300_000 }]);
    expect(scoreMatch(target, full)).toBeGreaterThan(scoreMatch(target, short));
  });

  it('skips the year signal when the target has no year', () => {
    const noYear: Target = { ...target, year: undefined };
    const c = candidate([
      { name: '01.flac', sizeBytes: 1, durationMs: 300_000 },
      { name: '02.flac', sizeBytes: 1, durationMs: 250_000 },
      { name: '03.flac', sizeBytes: 1, durationMs: 240_000 },
    ]);
    expect(scoreMatch(noYear, c)).toBeGreaterThan(0.9);
  });

  it('returns 0 when no signal in the pipeline applies', () => {
    // Only the duration signal, against a candidate whose files carry no durations.
    const c = candidate([{ name: '01.flac', sizeBytes: 1 }]);
    expect(scoreMatch(target, c, [durationSignal])).toBe(0);
  });

  it('composites the weighted signal mean to its exact known value', () => {
    // Track count (3/3 → 1), duration aligned (→ 1), title & artist contained (→ 1), year absent
    // (→ 0): weighted mean = 0.35·1 + 0.35·1 + 0.15·1 + 0.1·1 + 0.05·0 = 0.95 over unit weights.
    const c = candidate(
      [
        { name: '01.flac', sizeBytes: 1, durationMs: 300_000 },
        { name: '02.flac', sizeBytes: 1, durationMs: 250_000 },
        { name: '03.flac', sizeBytes: 1, durationMs: 240_000 },
      ],
      'Portishead - Dummy',
    );
    expect(scoreMatch(target, c)).toBeCloseTo(0.95, 10);
  });
});

describe('trackCountSignal', () => {
  it('scores the fraction of the expected count present (2 of 3 tracks → 0.667)', () => {
    const c = candidate([
      { name: '01.flac', sizeBytes: 1, durationMs: 300_000 },
      { name: '02.flac', sizeBytes: 1, durationMs: 250_000 },
    ]);
    expect(trackCountSignal.score(target, c)).toBeCloseTo(0.667, 3);
  });

  it('floors at 0 when the candidate carries twice the expected tracks', () => {
    const files = Array.from({ length: 6 }, (_unused, index) => ({
      name: `0${index}.flac`,
      sizeBytes: 1,
      durationMs: 300_000,
    }));
    expect(trackCountSignal.score(target, candidate(files))).toBe(0);
  });
});

describe('yearSignal', () => {
  const files = [{ name: '01.flac', sizeBytes: 1, durationMs: 300_000 }];

  it('scores 1 when the year appears in the candidate text', () => {
    expect(yearSignal.score(target, candidate(files, 'Portishead - Dummy 1994'))).toBe(1);
  });

  it('scores 0 when the year is absent', () => {
    expect(yearSignal.score(target, candidate(files, 'Portishead - Dummy'))).toBe(0);
  });
});
