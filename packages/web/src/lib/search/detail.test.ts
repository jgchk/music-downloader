import { describe, expect, it } from 'vitest';
import {
  chosenEdition,
  bestMatchSummary,
  editionSummary,
  formatCategory,
  groupHeading,
  narrowedToFormat,
  pickedMbid,
  releaseLine,
  trackTime,
} from './detail.js';
import type { DetailState } from './detail.js';
import type { CatalogEditionsResultDto } from '@music/downloader';

const MBID = '1b022e01-4da6-387b-8658-8678046e4cef';

const edition = (overrides: Record<string, unknown> = {}) => ({
  mbid: MBID,
  title: 'Graceland',
  formats: ['CD'],
  trackCount: 11,
  date: '1986-08-29',
  country: 'DE',
  ...overrides,
});

describe('editionSummary', () => {
  it('says what tells one pressing from another', () => {
    expect(editionSummary(edition())).toBe('1986-08-29 · DE · CD · 11 tracks');
  });

  it('leaves out what the catalog does not know, without leaving a gap', () => {
    expect(editionSummary(edition({ date: undefined, country: undefined }))).toBe('CD · 11 tracks');
  });

  it('counts one track as one track', () => {
    expect(editionSummary(edition({ trackCount: 1 }))).toContain('1 track');
  });

  it('says nothing about a length the catalog does not state', () => {
    expect(editionSummary(edition({ trackCount: undefined }))).toBe('1986-08-29 · DE · CD');
  });

  it('says nothing about a format the catalog does not name', () => {
    expect(editionSummary(edition({ formats: [] }))).toBe('1986-08-29 · DE · 11 tracks');
  });
});

describe('pickedMbid', () => {
  it('names the edition the pipeline would choose', () => {
    const editions: CatalogEditionsResultDto = {
      groups: [],
      bestMatch: { kind: 'pick', mbid: MBID },
    };

    expect(pickedMbid(editions)).toBe(MBID);
  });

  it('names none when the pipeline would ask instead of choosing', () => {
    const editions: CatalogEditionsResultDto = {
      groups: [],
      bestMatch: { kind: 'selection-required' },
    };

    expect(pickedMbid(editions)).toBeUndefined();
  });
});

describe('trackTime', () => {
  it('renders a running time the way a sleeve does', () => {
    expect(trackTime(239_000)).toBe('3:59');
    expect(trackTime(61_000)).toBe('1:01');
  });

  it('says nothing for a track the catalog has no timing for', () => {
    expect(trackTime(undefined)).toBe('');
  });
});

describe('groupHeading', () => {
  it('counts one tracklist and one pressing in the singular', () => {
    expect(
      groupHeading({ representative: edition({ trackCount: 1 }), editions: [edition()] }),
    ).toBe('1 track \u{00B7} 1 edition');
  });

  it('counts several in the plural', () => {
    expect(groupHeading({ representative: edition(), editions: [edition(), edition()] })).toBe(
      '11 tracks \u{00B7} 2 editions',
    );
  });

  it('says a tracklist is not stated rather than calling it zero tracks', () => {
    expect(
      groupHeading({ representative: edition({ trackCount: undefined }), editions: [edition()] }),
    ).toBe('Tracklist not stated \u{00B7} 1 edition');
  });
});

describe('releaseLine', () => {
  it('says when and of what kind, and nothing where the catalog is silent', () => {
    expect(releaseLine({ year: 1986, primaryType: 'Album' })).toBe('1986 \u{00B7} Album');
    expect(releaseLine({ year: undefined, primaryType: 'Album' })).toBe('Album');
    expect(releaseLine({ year: 1986, primaryType: undefined })).toBe('1986');
    expect(releaseLine({ year: undefined, primaryType: undefined })).toBe('');
  });
});

describe('chosenEdition', () => {
  const album = (mbid: string): DetailState => ({
    kind: 'release-group',
    mbid,
    title: 'Graceland',
    editions: { groups: [], bestMatch: { kind: 'selection-required' } },
  });

  it('is the edition chosen on the album that is open', () => {
    expect(chosenEdition(album(MBID), { album: MBID, edition: 'chosen' })).toBe('chosen');
  });

  it('is nothing until an edition has been chosen', () => {
    expect(chosenEdition(album(MBID), undefined)).toBeUndefined();
  });

  it('is nothing once a different album is opened', () => {
    // The surface is re-used, so a choice that outlived its album would request the first album's
    // pressing under the second album's name — a wrong-record download, silently.
    expect(chosenEdition(album('other'), { album: MBID, edition: 'chosen' })).toBeUndefined();
  });

  it('is nothing for anything that is not an album', () => {
    expect(
      chosenEdition(
        { kind: 'recording', mbid: MBID, title: 'A Track' },
        {
          album: MBID,
          edition: 'chosen',
        },
      ),
    ).toBeUndefined();
    expect(chosenEdition(undefined, undefined)).toBeUndefined();
  });
});

describe('formatCategory', () => {
  it.each([
    [['CD'], 'cd'],
    [['12" Vinyl'], 'vinyl'],
    [['Digital Media'], 'digital'],
    [['Cassette'], 'other'],
    [[], 'other'],
  ] as const)('files %s under %s', (formats, category) => {
    expect(formatCategory(formats)).toBe(category);
  });

  it('files a mixed pressing under the first thing a person would look for it as', () => {
    // A CD+DVD set is a CD to someone browsing for one; filing it under neither would hide it.
    expect(formatCategory(['CD', 'DVD'])).toBe('cd');
  });
});

describe('narrowedToFormat', () => {
  const editions = {
    groups: [
      {
        representative: { mbid: 'a', title: 'X', formats: ['CD'], trackCount: 11 },
        editions: [
          { mbid: 'a', title: 'X', formats: ['CD'], trackCount: 11 },
          { mbid: 'b', title: 'X', formats: ['12" Vinyl'], trackCount: 11 },
        ],
      },
    ],
    bestMatch: { kind: 'pick' as const, mbid: 'a' },
  };

  it('keeps only the pressings of the format asked for', () => {
    const narrowed = narrowedToFormat(editions, 'vinyl');

    expect(narrowed.groups[0]?.editions.map((edition) => edition.mbid)).toEqual(['b']);
  });

  it('recounts the groups it narrowed, so a heading cannot claim pressings that are gone', () => {
    const narrowed = narrowedToFormat(editions, 'vinyl');

    expect(narrowed.groups[0]?.editions).toHaveLength(1);
  });

  it('drops a group nothing survived in, rather than heading an empty list', () => {
    const narrowed = narrowedToFormat(editions, 'digital');

    expect(narrowed.groups).toEqual([]);
  });

  it('is the whole listing again when nothing is being asked for', () => {
    expect(narrowedToFormat(editions, 'all')).toEqual(editions);
  });
});

describe('bestMatchSummary', () => {
  it('says which pressing the system would take, and what makes it that one', () => {
    const summary = bestMatchSummary({
      groups: [
        {
          representative: { mbid: 'a', title: 'Graceland', formats: ['CD'], trackCount: 11 },
          editions: [
            {
              mbid: 'a',
              title: 'Graceland',
              disambiguation: 'gatefold',
              formats: ['CD'],
              trackCount: 11,
              date: '1986-08-29',
              country: 'DE',
            },
          ],
        },
      ],
      bestMatch: { kind: 'pick', mbid: 'a' },
    });

    expect(summary).toMatchObject({ kind: 'pick', mbid: 'a', title: 'Graceland (gatefold)' });
    expect(summary.kind === 'pick' && summary.detail).toContain('1986-08-29');
  });

  it('says plainly when there is nothing to take, rather than implying a choice was made', () => {
    const summary = bestMatchSummary({
      groups: [],
      bestMatch: { kind: 'selection-required' },
    });

    expect(summary.kind).toBe('selection-required');
  });

  it('asks for a choice when the pick names a pressing the listing does not have', () => {
    // The producer disagreeing with itself. "Choose one" is the honest reading, and the only one
    // a person can act on — naming a pressing that is not on screen would be worse than silence.
    const summary = bestMatchSummary({
      groups: [
        {
          representative: { mbid: 'a', title: 'X', formats: ['CD'], trackCount: 11 },
          editions: [{ mbid: 'a', title: 'X', formats: ['CD'], trackCount: 11 }],
        },
      ],
      bestMatch: { kind: 'pick', mbid: 'not-in-the-listing' },
    });

    expect(summary.kind).toBe('selection-required');
  });

  it('finds the pick wherever the catalog put it, not only in the first group', () => {
    const summary = bestMatchSummary({
      groups: [
        {
          representative: { mbid: 'a', title: 'X', formats: ['CD'], trackCount: 11 },
          editions: [{ mbid: 'a', title: 'X', formats: ['CD'], trackCount: 11 }],
        },
        {
          representative: { mbid: 'z', title: 'Deluxe', formats: ['CD'], trackCount: 19 },
          editions: [{ mbid: 'z', title: 'Deluxe', formats: ['CD'], trackCount: 19 }],
        },
      ],
      bestMatch: { kind: 'pick', mbid: 'z' },
    });

    // Groups sort by how many pressings share a tracklist; the pick is chosen on other grounds
    // entirely, so it is regularly not in the first one.
    expect(summary).toMatchObject({ kind: 'pick', title: 'Deluxe' });
  });
});
