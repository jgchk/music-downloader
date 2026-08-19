import { describe, expect, it } from 'vitest';
import { countOf, isCatalogId, orderedKinds, otherMatches } from './view.js';
import type { CatalogSearchResultDto } from '@music/downloader';

const MBID = '19847822-1430-3380-9cf1-bc45545b34ac';

function results(overrides: Partial<CatalogSearchResultDto> = {}): CatalogSearchResultDto {
  return {
    leading: 'release-group',
    releaseGroups: [
      { mbid: MBID, title: 'Graceland', artistCredit: 'Paul Simon', secondaryTypes: [] },
    ],
    artists: [{ mbid: MBID, name: 'Paul Simon' }],
    recordings: [{ mbid: MBID, title: 'The Boy in the Bubble', artistCredit: 'Paul Simon' }],
    ...overrides,
  };
}

describe('orderedKinds', () => {
  it('leads with the kind the catalog says the query was asking about', () => {
    expect(orderedKinds(results({ leading: 'artist' }), 'all')).toEqual([
      'artist',
      'release-group',
      'recording',
    ]);
    expect(orderedKinds(results({ leading: 'recording' }), 'all')).toEqual([
      'recording',
      'release-group',
      'artist',
    ]);
  });

  it('keeps albums, artists, tracks as the reading order behind the leading kind', () => {
    expect(orderedKinds(results(), 'all')).toEqual(['release-group', 'artist', 'recording']);
  });

  it('shows only what was filtered to, whatever the catalog says leads', () => {
    expect(orderedKinds(results({ leading: 'artist' }), 'recording')).toEqual(['recording']);
  });

  it('leaves out a kind that matched nothing, rather than heading an empty section', () => {
    expect(orderedKinds(results({ artists: [] }), 'all')).toEqual(['release-group', 'recording']);
  });
});

describe('otherMatches', () => {
  it('names the kinds that did match when the filtered kind did not, joined into a sentence', () => {
    expect(otherMatches(results({ recordings: [] }), 'recording')).toEqual([
      { kind: 'release-group', count: 1, joiner: '' },
      { kind: 'artist', count: 1, joiner: ' and ' },
    ]);
  });

  it('names nothing when nothing matched at all', () => {
    const nothing = results({ releaseGroups: [], artists: [], recordings: [] });

    expect(otherMatches(nothing, 'recording')).toEqual([]);
  });

  it('names nothing while looking at everything, since there is nowhere else to look', () => {
    expect(otherMatches(results({ recordings: [] }), 'all')).toEqual([]);
  });
});

describe('countOf', () => {
  it('counts what a kind matched', () => {
    expect(countOf(results(), 'release-group')).toBe(1);
    expect(countOf(results({ artists: [] }), 'artist')).toBe(0);
  });
});

describe('isCatalogId', () => {
  it('recognizes a pasted catalog identifier, whatever its casing or padding', () => {
    expect(isCatalogId(`  ${MBID.toUpperCase()}  `)).toBe(true);
  });

  it('does not mistake ordinary searching for an identifier', () => {
    expect(isCatalogId('paul simon graceland')).toBe(false);
    expect(isCatalogId('19847822-1430-3380-9cf1')).toBe(false);
  });
});
