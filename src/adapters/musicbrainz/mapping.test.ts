import { describe, expect, it } from 'vitest';
import {
  bestMatchId,
  normalizeTitle,
  recordingToTarget,
  releaseCandidateIds,
  releaseToTarget,
} from './mapping.js';
import type { MbScoredRelease } from './schemas.js';

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

  it('returns undefined when a track length is null (unknown duration)', () => {
    expect(
      releaseToTarget({
        title: 'X',
        'artist-credit': [{ name: 'A' }],
        media: [{ tracks: [{ position: 1, title: 'One', length: null }] }],
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

  it('returns undefined when the recording length is null', () => {
    expect(
      recordingToTarget({ title: 'A Song', length: null, 'artist-credit': [{ name: 'Solo' }] }),
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

describe('normalizeTitle', () => {
  it('treats case, punctuation, parentheses, and whitespace variants as equal', () => {
    const canonical = normalizeTitle('Midnights (3am Edition)');
    expect(normalizeTitle('midnights  3AM edition')).toBe(canonical);
    expect(normalizeTitle('MIDNIGHTS (3am Edition)')).toBe(canonical);
    expect(normalizeTitle('  Midnights — [3am] Edition!  ')).toBe(canonical);
  });

  it('does not equate a base title with a qualified edition title', () => {
    expect(normalizeTitle('Midnights')).not.toBe(normalizeTitle('Midnights (3am Edition)'));
  });
});

describe('releaseCandidateIds', () => {
  const hit = (over: Partial<MbScoredRelease> & { id: string }): MbScoredRelease => ({
    score: 100,
    title: 'Album',
    status: 'Official',
    date: '2020',
    'release-group': { id: 'rg-1' },
    ...over,
  });

  it('returns no candidates for empty or missing input', () => {
    expect(releaseCandidateIds(undefined, 'Album')).toEqual([]);
    expect(releaseCandidateIds([], 'Album')).toEqual([]);
  });

  it('resolves a single album whose editions all score alike (not ambiguous)', () => {
    const ids = releaseCandidateIds(
      [
        hit({ id: 'a', date: '2016' }),
        hit({ id: 'b', date: '2011' }),
        hit({ id: 'c', date: '2019' }),
      ],
      'Album',
    );

    // one release group → confident; canonical order is earliest official first
    expect(ids).toEqual(['b', 'a', 'c']);
  });

  it('is ambiguous when two different release groups score within the margin', () => {
    expect(
      releaseCandidateIds(
        [
          hit({ id: 'a', score: 100, 'release-group': { id: 'rg-1' } }),
          hit({ id: 'b', score: 95, 'release-group': { id: 'rg-2' } }),
        ],
        'Album',
      ),
    ).toEqual([]);
  });

  it('resolves the clearly-winning release group when the runner-up is far below', () => {
    expect(
      releaseCandidateIds(
        [
          hit({ id: 'a', score: 100, 'release-group': { id: 'rg-1' } }),
          hit({ id: 'b', score: 70, 'release-group': { id: 'rg-2' } }),
        ],
        'Album',
      ),
    ).toEqual(['a']);
  });

  it('returns no candidates when even the best group is below the confidence floor', () => {
    expect(releaseCandidateIds([hit({ id: 'a', score: 80 })], 'Album')).toEqual([]);
  });

  it('honors an edition named in the request text over the base edition', () => {
    const ids = releaseCandidateIds(
      [
        hit({ id: 'std', title: 'Midnights', date: '2022-10-21' }),
        hit({ id: 'threeam', title: 'Midnights (3am Edition)', date: '2022-10-22' }),
      ],
      'Midnights (3am Edition)',
    );

    expect(ids[0]).toBe('threeam');
  });

  it('falls back to the canonical edition when the request text matches no edition title', () => {
    const ids = releaseCandidateIds(
      [
        hit({ id: 'deluxe', title: 'Album (Deluxe)', status: 'Official', date: '2005' }),
        hit({ id: 'orig', title: 'Album (Remastered)', status: 'Official', date: '2001' }),
      ],
      'Album',
    );

    // no title matches "Album"; canonical rule alone orders the group by earliest official date
    expect(ids).toEqual(['orig', 'deluxe']);
  });

  it('keeps stable search order among equally-canonical (undated) releases', () => {
    const ids = releaseCandidateIds(
      [hit({ id: 'first', date: undefined }), hit({ id: 'second', date: undefined })],
      'Album',
    );

    expect(ids).toEqual(['first', 'second']);
  });

  it('prefers Official releases and sorts undated ones last', () => {
    const ids = releaseCandidateIds(
      [
        hit({ id: 'bootleg', status: 'Bootleg', date: '1990' }),
        hit({ id: 'undated', status: 'Official', date: undefined }),
        hit({ id: 'official', status: 'Official', date: '2000' }),
      ],
      'Album',
    );

    expect(ids).toEqual(['official', 'undated', 'bootleg']);
  });

  it('defaults a missing hit score to zero within its group', () => {
    const ids = releaseCandidateIds(
      [
        hit({ id: 'scored', score: 100, date: '2001' }),
        {
          id: 'unscored', // no score field → defaults to zero
          title: 'Album',
          status: 'Official',
          date: '2000',
          'release-group': { id: 'rg-1' },
        },
      ],
      'Album',
    );

    // the scored sibling makes rg-1 confident; canonical order still applies to both members
    expect(ids).toEqual(['unscored', 'scored']);
  });

  it('groups a hit lacking a release-group id as its own identity', () => {
    // two ungrouped hits are two singleton groups scoring alike → ambiguous
    expect(
      releaseCandidateIds(
        [
          { id: 'a', score: 100, title: 'Album' },
          { id: 'b', score: 100, title: 'Album' },
        ],
        'Album',
      ),
    ).toEqual([]);
  });

  it('skips a hit that carries no id', () => {
    expect(releaseCandidateIds([{ score: 100, title: 'Album' }], 'Album')).toEqual([]);
  });
});
