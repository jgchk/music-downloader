import { describe, expect, it } from 'vitest';
import {
  bestMatchId,
  normalizeTitle,
  recordingToTarget,
  releaseCandidateIds,
  releaseGroupCandidateIds,
  releaseGroupEditionCandidates,
  releaseGroupEditionIds,
  releaseToTarget,
} from './mapping.js';
import type { ReleaseGroupEdition } from './mapping.js';
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

  it('sorts a fully-specified date before a year-only date of the same year', () => {
    const ids = releaseCandidateIds(
      [hit({ id: 'yearonly', date: '2012' }), hit({ id: 'full', date: '2012-10-22' })],
      'Album',
    );

    // a precise date is more canonical than a vague year-only date within the same year,
    // so imprecision never displaces a precisely-dated edition
    expect(ids).toEqual(['full', 'yearonly']);
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

  it('prefers the exactly-titled group over a within-margin derivative-named sibling', () => {
    const ids = releaseCandidateIds(
      [
        hit({
          id: 'disc-orig',
          title: 'Discovery',
          date: '2001-03-12',
          'release-group': { id: 'rg-base', title: 'Discovery' },
        }),
        hit({
          id: 'disc-reissue',
          title: 'Discovery',
          date: '2014-01-01',
          'release-group': { id: 'rg-base', title: 'Discovery' },
        }),
        hit({
          id: 'remixed',
          score: 94,
          title: 'Discovery Remixed',
          'release-group': { id: 'rg-remix', title: 'Discovery Remixed' },
        }),
      ],
      'Discovery',
    );

    // rg-remix is within the margin of rg-base, but only rg-base bears the requested title
    expect(ids).toEqual(['disc-orig', 'disc-reissue']);
  });

  it('resolves the derivative group when the request names it (the preference is symmetric)', () => {
    const ids = releaseCandidateIds(
      [
        hit({
          id: 'base',
          score: 100,
          title: 'Discovery',
          'release-group': { id: 'rg-base', title: 'Discovery' },
        }),
        hit({
          id: 'remixed',
          score: 94,
          title: 'Discovery Remixed',
          'release-group': { id: 'rg-remix', title: 'Discovery Remixed' },
        }),
      ],
      'Discovery Remixed',
    );

    expect(ids).toEqual(['remixed']);
  });

  it('fails safe when multiple high-confidence groups bear the requested title', () => {
    expect(
      releaseCandidateIds(
        [
          hit({
            id: 'blue',
            score: 100,
            title: 'Weezer',
            'release-group': { id: 'rg-blue', title: 'Weezer' },
          }),
          hit({
            id: 'green',
            score: 95,
            title: 'Weezer',
            'release-group': { id: 'rg-green', title: 'Weezer' },
          }),
        ],
        'Weezer',
      ),
    ).toEqual([]);
  });

  it('keeps margin behavior when no group bears the requested title: clear winner resolves', () => {
    const ids = releaseCandidateIds(
      [
        hit({
          id: 'deluxe',
          score: 100,
          title: 'Album (Deluxe)',
          'release-group': { id: 'rg-1', title: 'Album (Deluxe)' },
        }),
        hit({
          id: 'live',
          score: 80,
          title: 'Album Live',
          'release-group': { id: 'rg-2', title: 'Album Live' },
        }),
      ],
      'Album',
    );

    expect(ids).toEqual(['deluxe']);
  });

  it('keeps margin behavior when no group bears the requested title: close scores stay ambiguous', () => {
    expect(
      releaseCandidateIds(
        [
          hit({
            id: 'deluxe',
            score: 100,
            title: 'Album (Deluxe)',
            'release-group': { id: 'rg-1', title: 'Album (Deluxe)' },
          }),
          hit({
            id: 'live',
            score: 95,
            title: 'Album Live',
            'release-group': { id: 'rg-2', title: 'Album Live' },
          }),
        ],
        'Album',
      ),
    ).toEqual([]);
  });

  it('does not let an exact title waive the confidence floor', () => {
    expect(
      releaseCandidateIds(
        [
          hit({
            id: 'base',
            score: 85,
            title: 'Discovery',
            'release-group': { id: 'rg-base', title: 'Discovery' },
          }),
          hit({
            id: 'remixed',
            score: 80,
            title: 'Discovery Remixed',
            'release-group': { id: 'rg-remix', title: 'Discovery Remixed' },
          }),
        ],
        'Discovery',
      ),
    ).toEqual([]);
  });

  it('lets a singleton hit without a release-group id win the preference via its release title', () => {
    const ids = releaseCandidateIds(
      [
        { id: 'solo', score: 100, title: 'Discovery', status: 'Official', date: '2001' },
        hit({
          id: 'remixed',
          score: 94,
          title: 'Discovery Remixed',
          'release-group': { id: 'rg-remix', title: 'Discovery Remixed' },
        }),
      ],
      'Discovery',
    );

    expect(ids).toEqual(['solo']);
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

describe('releaseGroupEditionIds', () => {
  const edition = (over: Partial<ReleaseGroupEdition> & { id: string }): ReleaseGroupEdition => ({
    status: 'Official',
    date: '2020',
    trackCount: 12,
    ...over,
  });

  it('returns no candidates for an empty group', () => {
    expect(releaseGroupEditionIds([])).toEqual([]);
  });

  it('returns no candidates when the group has no official edition', () => {
    const ids = releaseGroupEditionIds([
      edition({ id: 'boot', status: 'Bootleg', date: '2001' }),
      edition({ id: 'promo', status: 'Promotion', date: '2002' }),
    ]);
    expect(ids).toEqual([]);
  });

  it('prefers the modal official track count over a divergent (deluxe) edition', () => {
    // 13-track standard dominates the official editions; the 19-track deluxe must not win
    const ids = releaseGroupEditionIds([
      edition({ id: 'deluxe', trackCount: 19, date: '2014-10-27' }),
      edition({ id: 'std-a', trackCount: 13, date: '2014-10-27' }),
      edition({ id: 'std-b', trackCount: 13, date: '2015-03-01' }),
      edition({ id: 'std-c', trackCount: 13, date: '2016-01-01' }),
    ]);
    expect(ids).toEqual(['std-a', 'std-b', 'std-c']);
  });

  it('prefers a modal edition over an earlier official edition of divergent track count', () => {
    // the earliest official edition has a non-modal (12) count; the modal (10) editions win
    const ids = releaseGroupEditionIds([
      edition({ id: 'earlyodd', trackCount: 12, date: '2000-01-01' }),
      edition({ id: 'modal-a', trackCount: 10, date: '2005-01-01' }),
      edition({ id: 'modal-b', trackCount: 10, date: '2006-01-01' }),
    ]);
    expect(ids).toEqual(['modal-a', 'modal-b']);
  });

  it('ignores non-official editions when computing the mode and selecting', () => {
    // non-official 15-track editions outnumber the official 12-track ones, but only officials count
    const ids = releaseGroupEditionIds([
      edition({ id: 'v1', status: 'Bootleg', trackCount: 15, date: '2011' }),
      edition({ id: 'v2', status: 'Bootleg', trackCount: 15, date: '2012' }),
      edition({ id: 'v3', status: 'Bootleg', trackCount: 15, date: '2013' }),
      edition({ id: 'official', status: 'Official', trackCount: 12, date: '2012-05-01' }),
    ]);
    expect(ids).toEqual(['official']);
  });

  it('breaks a modal tie toward the lower track count', () => {
    // two official counts equally common (12 x2, 14 x2) -> pick the 12-track editions
    const ids = releaseGroupEditionIds([
      edition({ id: 'a12', trackCount: 12, date: '2001' }),
      edition({ id: 'b14', trackCount: 14, date: '2002' }),
      edition({ id: 'c12', trackCount: 12, date: '2003' }),
      edition({ id: 'd14', trackCount: 14, date: '2004' }),
    ]);
    expect(ids).toEqual(['a12', 'c12']);
  });

  it('orders modal editions by earliest date, precise before year-only within a year', () => {
    const ids = releaseGroupEditionIds([
      edition({ id: 'yearonly', date: '2012' }),
      edition({ id: 'later', date: '2013-01-01' }),
      edition({ id: 'full', date: '2012-06-15' }),
    ]);
    expect(ids).toEqual(['full', 'yearonly', 'later']);
  });

  it('keeps stable input order among modal editions with equal dates', () => {
    const ids = releaseGroupEditionIds([
      edition({ id: 'first', date: '2000' }),
      edition({ id: 'second', date: '2000' }),
    ]);
    expect(ids).toEqual(['first', 'second']);
  });
});

describe('releaseGroupCandidateIds', () => {
  it('returns no candidates for empty or missing input', () => {
    expect(releaseGroupCandidateIds(undefined)).toEqual([]);
    expect(releaseGroupCandidateIds([])).toEqual([]);
  });

  it('sums each edition media track-counts and picks the modal official edition', () => {
    const ids = releaseGroupCandidateIds([
      // deluxe: 8 + 11 = 19 tracks
      {
        id: 'deluxe',
        status: 'Official',
        date: '2014-10-27',
        media: [{ 'track-count': 8 }, { 'track-count': 11 }],
      },
      // standard editions: 13 tracks each (the mode)
      { id: 'std-a', status: 'Official', date: '2014-10-27', media: [{ 'track-count': 13 }] },
      {
        id: 'std-b',
        status: 'Official',
        date: '2015-01-01',
        media: [{ 'track-count': 6 }, { 'track-count': 7 }],
      },
    ]);

    expect(ids).toEqual(['std-a', 'std-b']);
  });

  it('drops editions without an id and treats a medium with no track-count as zero', () => {
    const ids = releaseGroupCandidateIds([
      { status: 'Official', date: '2001', media: [{ 'track-count': 12 }] }, // no id → dropped
      // second medium carries no track-count → contributes 0, total stays 12
      { id: 'known', status: 'Official', date: '2002', media: [{ 'track-count': 12 }, {}] },
    ]);

    expect(ids).toEqual(['known']);
  });

  it('treats an edition with no media as zero tracks', () => {
    expect(releaseGroupCandidateIds([{ id: 'x', status: 'Official', date: '2000' }])).toEqual([
      'x',
    ]);
  });

  it('returns no candidates when no edition is official', () => {
    expect(
      releaseGroupCandidateIds([
        { id: 'boot', status: 'Bootleg', date: '2001', media: [{ 'track-count': 12 }] },
      ]),
    ).toEqual([]);
  });
});

describe('releaseGroupEditionCandidates', () => {
  it('presents no candidates for empty or missing input', () => {
    expect(releaseGroupEditionCandidates(undefined)).toEqual([]);
    expect(releaseGroupEditionCandidates([])).toEqual([]);
  });

  it('presents every identified edition with its identifying metadata', () => {
    const candidates = releaseGroupEditionCandidates([
      { status: 'Bootleg', date: '2001', media: [{ 'track-count': 9 }] }, // no id → nothing to select
      {
        id: 'boot',
        title: 'Live at Budokan',
        status: 'Bootleg',
        date: '1995-05-01',
        country: 'JP',
        media: [{ 'track-count': 12, format: 'CD' }],
      },
    ]);

    expect(candidates).toEqual([
      {
        releaseMbid: 'boot',
        title: 'Live at Budokan',
        date: '1995-05-01',
        country: 'JP',
        format: 'CD',
        trackCount: 12,
      },
    ]);
  });

  it('sums track counts across media and joins the distinct formats', () => {
    const candidates = releaseGroupEditionCandidates([
      {
        id: 'double',
        media: [
          { 'track-count': 8, format: 'CD' },
          { 'track-count': 5, format: 'CD' },
          { 'track-count': 1, format: 'DVD-Video' },
        ],
      },
    ]);

    expect(candidates[0]).toMatchObject({ trackCount: 14, format: 'CD + DVD-Video' });
  });

  it('leaves presentation fields absent when the browse omits them', () => {
    const candidates = releaseGroupEditionCandidates([{ id: 'sparse' }]);

    expect(candidates).toEqual([{ releaseMbid: 'sparse', trackCount: 0 }]);
  });

  it('treats a null country and media format as absent (MusicBrainz reports unknowns as null)', () => {
    const candidates = releaseGroupEditionCandidates([
      { id: 'nulled', country: null, media: [{ 'track-count': 3, format: null }] },
    ]);

    expect(candidates).toEqual([{ releaseMbid: 'nulled', trackCount: 3 }]);
  });

  it('orders candidates by the picker heuristic: modal track count first, then earliest date', () => {
    const candidates = releaseGroupEditionCandidates([
      { id: 'odd', date: '1990', media: [{ 'track-count': 20 }] },
      { id: 'late-modal', date: '2002-06-01', media: [{ 'track-count': 12 }] },
      { id: 'early-modal', date: '2001', media: [{ 'track-count': 12 }] },
    ]);

    expect(candidates.map((candidate) => candidate.releaseMbid)).toEqual([
      'early-modal',
      'late-modal',
      'odd',
    ]);
  });

  it('keeps stable input order among candidates with equal rank', () => {
    const candidates = releaseGroupEditionCandidates([
      { id: 'first', date: '2000', media: [{ 'track-count': 10 }] },
      { id: 'second', date: '2000', media: [{ 'track-count': 10 }] },
    ]);

    expect(candidates.map((candidate) => candidate.releaseMbid)).toEqual(['first', 'second']);
  });
});
