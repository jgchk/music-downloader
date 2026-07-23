import { describe, expect, it } from 'vitest';
import { createTarget, totalDurationMs, trackCount } from './target.js';
import type { TargetInput } from './target.js';
import { asMbid } from '../shared/__fixtures__/mbid.js';

function albumInput(overrides: Partial<TargetInput> = {}): TargetInput {
  return {
    type: 'album',
    artist: 'Boards of Canada',
    title: 'Music Has the Right to Children',
    year: 1998,
    mbid: asMbid('b1392450-e666-3926-a536-22c65f834433'),
    tracks: [
      { position: 1, title: 'Wildlife Analysis', durationMs: 78_000 },
      { position: 2, title: 'An Eagle in Your Mind', durationMs: 380_000 },
    ],
    ...overrides,
  };
}

describe('createTarget', () => {
  it('produces a canonical target from valid input', () => {
    const result = createTarget(albumInput());
    expect(result.isOk()).toBe(true);
    expect(result._unsafeUnwrap().artist).toBe('Boards of Canada');
  });

  it('trims surrounding whitespace on artist and title', () => {
    const result = createTarget(albumInput({ artist: '  Aphex Twin  ', title: '  Windowlicker ' }));
    const target = result._unsafeUnwrap();
    expect(target.artist).toBe('Aphex Twin');
    expect(target.title).toBe('Windowlicker');
  });

  it('rejects an empty artist', () => {
    const result = createTarget(albumInput({ artist: ' '.repeat(3) }));
    expect(result._unsafeUnwrapErr()).toEqual({ kind: 'EmptyArtist' });
  });

  it('rejects an empty title', () => {
    const result = createTarget(albumInput({ title: '' }));
    expect(result._unsafeUnwrapErr()).toEqual({ kind: 'EmptyTitle' });
  });

  it('rejects a target with no tracks', () => {
    const result = createTarget(albumInput({ tracks: [] }));
    expect(result._unsafeUnwrapErr()).toEqual({ kind: 'NoTracks' });
  });

  it('rejects a non-positive track duration and reports the position', () => {
    const result = createTarget(
      albumInput({ tracks: [{ position: 3, title: 'Silence', durationMs: 0 }] }),
    );
    expect(result._unsafeUnwrapErr()).toEqual({ kind: 'InvalidTrackDuration', position: 3 });
  });

  it('rejects a non-positive track position, since a position is a 1-based ordinal', () => {
    const result = createTarget(
      albumInput({ tracks: [{ position: 0, title: 'Prelude', durationMs: 1000 }] }),
    );
    expect(result._unsafeUnwrapErr()).toEqual({ kind: 'InvalidTrackPosition', position: 0 });
  });

  it('rejects a fractional track position, since a position is a whole ordinal', () => {
    const result = createTarget(
      albumInput({ tracks: [{ position: 1.5, title: 'Interlude', durationMs: 1000 }] }),
    );
    expect(result._unsafeUnwrapErr()).toEqual({ kind: 'InvalidTrackPosition', position: 1.5 });
  });
});

describe('derived accessors', () => {
  it('counts tracks', () => {
    expect(trackCount(createTarget(albumInput())._unsafeUnwrap())).toBe(2);
  });

  it('sums per-track durations', () => {
    expect(totalDurationMs(createTarget(albumInput())._unsafeUnwrap())).toBe(458_000);
  });
});
