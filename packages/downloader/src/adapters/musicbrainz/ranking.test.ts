import { describe, expect, it } from 'vitest';
import { asMbid } from '../../domain/shared/__fixtures__/mbid.js';
import { leadingKind, rankArtists, rankRecordings, rankReleaseGroups } from './ranking.js';
import type { ScoredArtist, ScoredRecording, ScoredReleaseGroup } from './ranking.js';

/**
 * Relevance fixtures are written in the catalog's own language (title, artist credit, type) rather
 * than raw provider JSON: ranking is judged on what a searcher sees, and the provider's own score
 * rides along only as the tie-break it is.
 */
function releaseGroup(
  title: string,
  artistCredit: string,
  extras: Partial<ScoredReleaseGroup> = {},
): ScoredReleaseGroup {
  return {
    mbid: asMbid(`rg-${title}-${artistCredit}`),
    title,
    artistCredit,
    year: undefined,
    primaryType: 'Album',
    secondaryTypes: [],
    score: 50,
    ...extras,
  };
}

function artist(name: string, extras: Partial<ScoredArtist> = {}): ScoredArtist {
  return { mbid: asMbid(`ar-${name}`), name, disambiguation: undefined, score: 50, ...extras };
}

function recording(
  title: string,
  artistCredit: string,
  extras: Partial<ScoredRecording> = {},
): ScoredRecording {
  return {
    mbid: asMbid(`rec-${title}`),
    title,
    artistCredit,
    release: { mbid: asMbid(`rel-${title}`), title: `${title} (single)` },
    score: 50,
    ...extras,
  };
}

const titles = (items: readonly { readonly title: string }[]): readonly string[] =>
  items.map((item) => item.title);

describe('rankReleaseGroups', () => {
  it('ranks the album by the searched artist above a same-titled work by someone else', () => {
    // The provider scores the tribute highest — its *title* contains every query token — while the
    // real album spends "paul simon" on its artist credit. Crediting the artist field is the whole
    // point of ranking here.
    const ranked = rankReleaseGroups('paul simon graceland', [
      releaseGroup("Paul Simon's Graceland: Solo Marimba", 'Arthur Lipner', { score: 100 }),
      releaseGroup('Graceland', 'Paul Simon', { score: 49 }),
    ]);

    expect(titles(ranked)).toEqual(['Graceland', "Paul Simon's Graceland: Solo Marimba"]);
  });

  it('penalizes title words the searcher never typed', () => {
    const ranked = rankReleaseGroups('graceland', [
      releaseGroup('Graceland: The Remixes Deluxe Anniversary Edition', 'Paul Simon'),
      releaseGroup('Graceland', 'Paul Simon'),
    ]);

    expect(titles(ranked)[0]).toBe('Graceland');
  });

  it('ranks a standard album above the same album as a live or remix release', () => {
    const ranked = rankReleaseGroups('graceland', [
      releaseGroup('Graceland', 'Paul Simon', { secondaryTypes: ['Live'] }),
      releaseGroup('Graceland', 'Paul Simon', { secondaryTypes: ['Remix'] }),
      releaseGroup('Graceland', 'Paul Simon'),
    ]);

    expect(ranked[0]?.secondaryTypes).toEqual([]);
  });

  it('prefers an album over an EP and a single of the same name', () => {
    const ranked = rankReleaseGroups('graceland', [
      releaseGroup('Graceland', 'Paul Simon', { primaryType: 'Single' }),
      releaseGroup('Graceland', 'Paul Simon', { primaryType: 'EP' }),
      releaseGroup('Graceland', 'Paul Simon', { primaryType: 'Album' }),
    ]);

    expect(ranked.map((item) => item.primaryType)).toEqual(['Album', 'EP', 'Single']);
  });

  it('falls back to the provider score when nothing else separates two hits', () => {
    const ranked = rankReleaseGroups('graceland', [
      releaseGroup('Graceland', 'Paul Simon', { score: 30 }),
      releaseGroup('Graceland', 'Paul Simon', { score: 90 }),
    ]);

    expect(ranked.map((item) => item.score)).toEqual([90, 30]);
  });

  it('ignores diacritics and punctuation when matching', () => {
    const ranked = rankReleaseGroups('bjork vespertine', [
      releaseGroup('Vespertine Live', 'Someone Else'),
      releaseGroup('Vespertine', 'Björk'),
    ]);

    expect(titles(ranked)[0]).toBe('Vespertine');
  });

  it('judges a hit the catalog credits to nobody on its title alone', () => {
    const ranked = rankReleaseGroups('graceland', [
      releaseGroup('Something Else', ''),
      releaseGroup('Graceland', ''),
    ]);

    expect(titles(ranked)[0]).toBe('Graceland');
  });

  it('counts a query the artist alone explains as fully explained', () => {
    // Every query token is the artist's name, so there is nothing left for the title to match —
    // which must read as "the title has nothing to answer for", not as a title that failed.
    const ranked = rankReleaseGroups('paul simon', [
      releaseGroup('Hearts and Bones', 'Paul Simon'),
      releaseGroup('A Tribute', 'Someone Else'),
    ]);

    expect(titles(ranked)[0]).toBe('Hearts and Bones');
  });

  it('neither rewards nor punishes a release whose type the catalog does not name', () => {
    const ranked = rankReleaseGroups('graceland', [
      releaseGroup('Graceland', 'Paul Simon', { primaryType: 'Broadcast' }),
      releaseGroup('Graceland', 'Paul Simon', { primaryType: undefined }),
      releaseGroup('Graceland', 'Paul Simon', { primaryType: 'Album' }),
    ]);

    expect(ranked.map((item) => item.primaryType)).toEqual(['Album', 'Broadcast', undefined]);
  });

  it('returns nothing for no hits, and leaves a blank query in provider order', () => {
    expect(rankReleaseGroups('graceland', [])).toEqual([]);
    expect(
      titles(rankReleaseGroups(' '.repeat(3), [releaseGroup('B', 'X'), releaseGroup('A', 'X')])),
    ).toEqual(['B', 'A']);
  });
});

describe('rankArtists', () => {
  it('puts an exact name match first', () => {
    const ranked = rankArtists('paul simon', [
      artist('Paul Simon Tribute Band', { score: 100 }),
      artist('Paul Simon', { score: 40 }),
    ]);

    expect(ranked.map((item) => item.name)[0]).toBe('Paul Simon');
  });

  it('prefers the longest name the query contains, so a fuller name beats a fragment', () => {
    // "graceland" is an artist in its own right; searching the album with its artist should still
    // surface Paul Simon above the band literally named Graceland.
    const ranked = rankArtists('paul simon graceland', [
      artist('Graceland', { score: 90 }),
      artist('Paul Simon', { score: 60 }),
    ]);

    expect(ranked.map((item) => item.name)[0]).toBe('Paul Simon');
  });

  it('leaves a nameless artist to the provider score', () => {
    const ranked = rankArtists('paul simon', [
      artist('', { score: 90 }),
      artist('Nobody', { score: 10 }),
    ]);

    expect(ranked.map((item) => item.score)).toEqual([90, 10]);
  });

  it('matches a name on whole words, so a fragment of one does not pass as the artist', () => {
    // "radiohead in rainbows" contains the letters of both `Head` and `Rain`; neither was named.
    const ranked = rankArtists('radiohead in rainbows', [
      artist('Head', { score: 90 }),
      artist('Rain', { score: 90 }),
      artist('Radiohead', { score: 60 }),
    ]);

    expect(ranked.map((item) => item.name)[0]).toBe('Radiohead');
  });

  it('orders unmatched names by the provider score', () => {
    const ranked = rankArtists('something else', [
      artist('Alpha', { score: 10 }),
      artist('Beta', { score: 80 }),
    ]);

    expect(ranked.map((item) => item.name)).toEqual(['Beta', 'Alpha']);
  });
});

describe('rankRecordings', () => {
  it('ranks the searched track by the searched artist first', () => {
    const ranked = rankRecordings('paul simon the boy in the bubble', [
      recording('The Boy in the Bubble (live)', 'A Tribute Band', { score: 100 }),
      recording('The Boy in the Bubble', 'Paul Simon', { score: 60 }),
    ]);

    expect(titles(ranked)[0]).toBe('The Boy in the Bubble');
  });

  it('sinks a recording that appears on no release, since there is nothing to fetch', () => {
    const ranked = rankRecordings('graceland', [
      recording('Graceland', 'Paul Simon', { release: undefined }),
      recording('Graceland', 'Paul Simon'),
    ]);

    expect(ranked[0]?.release).toBeDefined();
  });
});

describe('leadingKind', () => {
  const graceland = releaseGroup('Graceland', 'Paul Simon');
  const paulSimon = artist('Paul Simon');
  const boyInTheBubble = recording('The Boy in the Bubble', 'Paul Simon');

  it('leads with artists when the query is exactly an artist name', () => {
    expect(
      leadingKind('paul simon', {
        releaseGroups: [graceland],
        artists: [paulSimon],
        recordings: [boyInTheBubble],
      }),
    ).toBe('artist');
  });

  it('leads with albums when the query names an artist and an album', () => {
    expect(
      leadingKind('paul simon graceland', {
        releaseGroups: [graceland],
        artists: [paulSimon],
        recordings: [boyInTheBubble],
      }),
    ).toBe('release-group');
  });

  it('leads with tracks when the query names an artist and a track', () => {
    expect(
      leadingKind('paul simon the boy in the bubble', {
        releaseGroups: [graceland],
        artists: [paulSimon],
        recordings: [boyInTheBubble],
      }),
    ).toBe('recording');
  });

  it('does not let a single named after the track pass as album evidence', () => {
    // MusicBrainz lists "The Boy in the Bubble" as a single too; counting it as an album match
    // would keep albums leading for what is plainly a track search.
    expect(
      leadingKind('paul simon the boy in the bubble', {
        releaseGroups: [
          releaseGroup('The Boy in the Bubble', 'Paul Simon', { primaryType: 'Single' }),
        ],
        artists: [],
        recordings: [boyInTheBubble],
      }),
    ).toBe('recording');
  });

  it('keeps albums leading when a track only narrowly outscores the best album', () => {
    // The margin is what "clearly outranks" means: a near-tie is not evidence of a track search.
    const nearTie = recording('Graceland', 'Paul Simon');

    expect(
      leadingKind('paul simon graceland', {
        releaseGroups: [graceland],
        artists: [],
        recordings: [nearTie],
      }),
    ).toBe('release-group');
  });

  it('leads with albums by default, including when there is nothing to compare', () => {
    expect(leadingKind('anything', { releaseGroups: [], artists: [], recordings: [] })).toBe(
      'release-group',
    );
  });
});
