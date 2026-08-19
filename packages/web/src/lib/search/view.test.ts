import { describe, expect, it } from 'vitest';
import {
  TOP_RESULTS,
  albumDetail,
  alternativeLabel,
  artUrl,
  countOf,
  emptyLead,
  initialsOf,
  isCatalogId,
  orderedKinds,
  otherMatches,
  topResults,
  trackDetail,
  trimmedCount,
} from './view.js';
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
  it('keeps a block the catalog could not be read for, so its absence can be explained', () => {
    // An empty block means "nothing matched" OR "nobody could ask"; dropping the second silently
    // tells someone to check their spelling when the spelling was never the problem.
    const answered = {
      leading: 'release-group' as const,
      releaseGroups: [],
      artists: [],
      recordings: [],
      unavailable: [{ kind: 'artist' as const, reason: 'unreachable' as const }],
    };

    expect(orderedKinds(answered, 'all')).toEqual(['artist']);
  });

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

describe('alternativeLabel', () => {
  it('counts one of a kind in the singular', () => {
    expect(alternativeLabel({ kind: 'release-group', count: 1, joiner: '' })).toBe('1 album');
    expect(alternativeLabel({ kind: 'artist', count: 1, joiner: '' })).toBe('1 artist');
    expect(alternativeLabel({ kind: 'recording', count: 1, joiner: '' })).toBe('1 track');
  });

  it('counts more than one in the plural', () => {
    expect(alternativeLabel({ kind: 'release-group', count: 3, joiner: '' })).toBe('3 albums');
  });
});

describe('emptyLead', () => {
  it('names the kind that matched nothing and the query it was asked for', () => {
    expect(
      emptyLead('recording', 'graceland', [{ kind: 'release-group', count: 1, joiner: '' }]),
    ).toBe('No tracks matched \u{201C}graceland\u{201D} \u{2014} but');
  });

  it('says nothing matched anywhere, and how to go straight to a record', () => {
    expect(emptyLead('recording', 'zzz', [])).toContain('Nothing matched');
    expect(emptyLead('recording', 'zzz', [])).toContain('paste a MusicBrainz ID');
  });

  it('never asks for the name of a filter that is not a kind', () => {
    // `all` has no plain name; asking for one would render "No undefined matched".
    expect(emptyLead('all', 'zzz', [{ kind: 'artist', count: 2, joiner: '' }])).toContain(
      'Nothing matched',
    );
  });
});

describe('albumDetail and trackDetail', () => {
  it('joins what the catalog knows, and leaves no separator where it knows nothing', () => {
    expect(albumDetail({ artistCredit: 'Paul Simon', year: 1986 })).toBe(
      'Paul Simon \u{00B7} 1986',
    );
    expect(albumDetail({ artistCredit: 'Paul Simon', year: undefined })).toBe('Paul Simon');
    expect(albumDetail({ artistCredit: '', year: 1986 })).toBe('1986');
  });

  it('names the release a track sits on, when it sits on one', () => {
    expect(trackDetail({ artistCredit: 'Paul Simon', release: { title: 'Graceland' } })).toBe(
      'Paul Simon \u{00B7} Graceland',
    );
    expect(trackDetail({ artistCredit: 'Paul Simon', release: undefined })).toBe('Paul Simon');
  });
});

describe('artUrl', () => {
  it('asks this application for artwork, at the size being rendered', () => {
    expect(artUrl('release-group', 'rg-1', 250)).toBe('/cover-art/release-group/rg-1?size=250');
    expect(artUrl('release', 'rel-1', 500)).toBe('/cover-art/release/rel-1?size=500');
  });
});

describe('topResults', () => {
  const many = (count: number) =>
    results({
      releaseGroups: Array.from({ length: count }, (_unused, index) => ({
        mbid: MBID,
        title: `Album ${index}`,
        artistCredit: 'Someone',
        secondaryTypes: [],
      })),
    });

  it('shows a person the leading slice rather than the whole ranked pool', () => {
    // Past the head, ranking positions are token coincidence: a wall of them buries the other
    // kinds and costs an artwork request each.
    const shown = topResults(many(25).releaseGroups, 'release-group', 'all');

    expect(shown).toHaveLength(TOP_RESULTS['release-group']);
  });

  it('shows everything of one kind once that kind is what is being looked at', () => {
    const shown = topResults(many(25).releaseGroups, 'release-group', 'release-group');

    expect(shown).toHaveLength(25);
  });

  it('does not trim what already fits', () => {
    const shown = topResults(many(3).releaseGroups, 'release-group', 'all');

    expect(shown).toHaveLength(3);
  });
});

describe('trimmedCount', () => {
  it('states the trim so the count on screen is not a lie', () => {
    const shown = trimmedCount(25, 10);

    expect(shown).toEqual({ isTrimmed: true, shown: 10, matched: 25, label: '10 of 25' });
  });

  it('says the plain number when nothing was held back', () => {
    const shown = trimmedCount(6, 6);

    expect(shown).toEqual({ isTrimmed: false, shown: 6, matched: 6, label: '6' });
  });
});

describe('initialsOf', () => {
  it.each([
    ['Graceland', 'G'],
    ['Paul Simon', 'PS'],
    ['The Rise and Fall of Ziggy Stardust', 'TR'],
    ['sam kurt', 'SK'],
  ])('stands in for %s’s missing cover with %s', (title, initials) => {
    expect(initialsOf(title)).toBe(initials);
  });

  it('still says something for a record whose title is blank', () => {
    // An empty placeholder is the empty grey box the placeholder exists to replace.
    expect(initialsOf(' '.repeat(3))).toBe('♪');
  });
});
