import { describe, expect, it } from 'vitest';
import { bestMatchId, recordingToTarget, releaseToTarget } from './mapping.js';

describe('releaseToTarget', () => {
  it('maps a release, joining artist credits and flattening media into tracks', () => {
    const target = releaseToTarget({
      id: 'rel-1',
      title: 'Great Album',
      date: '2020-05-01',
      'artist-credit': [{ name: 'A', joinphrase: ' & ' }, { name: 'B' }, {}],
      media: [
        { tracks: [{ position: 1, title: 'One', length: 60000 }] },
        {
          tracks: [{ position: 2, recording: { title: 'Two', length: 120000 } }, { length: 1000 }],
        },
        {}, // a medium with no tracks is skipped
      ],
    });

    expect(target).toEqual({
      type: 'album',
      artist: 'A & B',
      title: 'Great Album',
      year: 2020,
      mbid: 'rel-1',
      tracks: [
        { position: 1, title: 'One', durationMs: 60000 }, // both from the track
        { position: 2, title: 'Two', durationMs: 120000 }, // title/length fall back to the recording
        { position: 2, title: '', durationMs: 1000 }, // no position → per-medium index; no title → ''
      ],
    });
  });

  it('drops a non-positive release year', () => {
    const target = releaseToTarget({
      title: 'X',
      date: '0000',
      'artist-credit': [{ name: 'A' }],
      media: [{ tracks: [{ position: 1, title: 'One', length: 1 }] }],
    });

    expect(target?.year).toBeUndefined();
  });

  it('returns undefined for a release with no tracks', () => {
    expect(releaseToTarget({ title: 'X', 'artist-credit': [{ name: 'A' }] })).toBeUndefined();
  });

  it('returns undefined when a track has no usable duration', () => {
    expect(
      releaseToTarget({
        title: 'X',
        'artist-credit': [{ name: 'A' }],
        media: [{ tracks: [{ position: 1, title: 'One' }] }],
      }),
    ).toBeUndefined();
  });

  it('returns undefined when the artist credit is missing', () => {
    expect(
      releaseToTarget({
        title: 'X',
        media: [{ tracks: [{ position: 1, title: 'One', length: 1 }] }],
      }),
    ).toBeUndefined();
  });

  it('returns undefined when the release has no title', () => {
    expect(
      releaseToTarget({
        'artist-credit': [{ name: 'A' }],
        media: [{ tracks: [{ position: 1, title: 'One', length: 1 }] }],
      }),
    ).toBeUndefined();
  });
});

describe('recordingToTarget', () => {
  it('maps a recording to a single-track target', () => {
    const target = recordingToTarget({
      id: 'rec-1',
      title: 'A Song',
      length: 200000,
      'artist-credit': [{ name: 'Solo' }],
    });

    expect(target).toEqual({
      type: 'track',
      artist: 'Solo',
      title: 'A Song',
      mbid: 'rec-1',
      tracks: [{ position: 1, title: 'A Song', durationMs: 200000 }],
    });
  });

  it('returns undefined when the recording has no length', () => {
    expect(
      recordingToTarget({ title: 'A Song', 'artist-credit': [{ name: 'Solo' }] }),
    ).toBeUndefined();
  });

  it('returns undefined when the recording has no title', () => {
    expect(
      recordingToTarget({ length: 1000, 'artist-credit': [{ name: 'Solo' }] }),
    ).toBeUndefined();
  });
});

describe('bestMatchId', () => {
  it('returns undefined for no entries', () => {
    expect(bestMatchId(undefined)).toBeUndefined();
    expect(bestMatchId([])).toBeUndefined();
  });

  it('returns undefined when the top score is below the confidence floor', () => {
    expect(bestMatchId([{ id: 'a', score: 80 }])).toBeUndefined();
  });

  it('returns undefined when the top two hits are too close (ambiguous)', () => {
    expect(
      bestMatchId([
        { id: 'a', score: 95 },
        { id: 'b', score: 90 },
      ]),
    ).toBeUndefined();
  });

  it('picks the clear, confident winner', () => {
    expect(
      bestMatchId([
        { id: 'b', score: 70 },
        { id: 'a', score: 96 },
      ]),
    ).toBe('a');
  });

  it('accepts a single confident hit and treats a missing score as zero', () => {
    expect(bestMatchId([{ id: 'a', score: 92 }])).toBe('a');
    expect(bestMatchId([{ id: 'a' }])).toBeUndefined();
  });
});
