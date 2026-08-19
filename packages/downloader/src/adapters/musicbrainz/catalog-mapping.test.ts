import { describe, expect, it } from 'vitest';
import {
  toArtists,
  toDiscography,
  toEditionListing,
  toRecordings,
  toReleaseGroups,
  toTracks,
} from './catalog-mapping.js';

const RG_ID = '19847822-1430-3380-9cf1-bc45545b34ac';
const RG_ID_2 = '271faeb3-fdd1-3ebb-80aa-97b3116e9341';
const ARTIST_ID = '4d5447d7-c61c-4120-ba1b-d7f471d385b9';
const RECORDING_ID = '0b6b4ba0-d36f-47bd-b4ea-6a5b91842d29';
const RELEASE_ID = '1b022e01-4da6-387b-8658-8678046e4cef';
const RELEASE_ID_2 = 'ef6e0c0a-9f1f-41af-820a-e3ca91560c13';

describe('toReleaseGroups', () => {
  it('reads an album identity a searcher would recognize', () => {
    const [group] = toReleaseGroups({
      'release-groups': [
        {
          id: RG_ID,
          score: 91,
          title: 'Graceland',
          'first-release-date': '1986-08-25',
          'primary-type': 'Album',
          'secondary-types': ['Live'],
          'artist-credit': [{ name: 'Paul Simon', joinphrase: ' & ' }, { name: 'Ladysmith' }],
        },
      ],
    });

    expect(group).toEqual({
      mbid: RG_ID,
      title: 'Graceland',
      artistCredit: 'Paul Simon & Ladysmith',
      year: 1986,
      primaryType: 'Album',
      secondaryTypes: ['Live'],
      score: 91,
    });
  });

  it('fills in what the catalog leaves unsaid, without inventing it', () => {
    const [group] = toReleaseGroups({
      'release-groups': [{ id: RG_ID, title: 'Untyped', 'first-release-date': null }],
    });

    expect(group).toMatchObject({
      artistCredit: '',
      year: undefined,
      primaryType: undefined,
      secondaryTypes: [],
      score: 0,
    });
  });

  it('takes the year from a year-only release date', () => {
    const [group] = toReleaseGroups({
      'release-groups': [{ id: RG_ID, title: 'Old', 'first-release-date': '1972' }],
    });

    expect(group?.year).toBe(1972);
  });

  it('drops a hit that cannot be presented or requested — no id, or no title', () => {
    const groups = toReleaseGroups({
      'release-groups': [
        { title: 'Nameless id' },
        { id: 'not-a-uuid', title: 'Bad id' },
        { id: RG_ID, title: null },
        { id: RG_ID_2, title: 'Keeper' },
      ],
    });

    expect(groups.map((group) => group.title)).toEqual(['Keeper']);
  });

  it('reads an absent list as no hits', () => {
    expect(toReleaseGroups({})).toEqual([]);
  });
});

describe('toArtists', () => {
  it('reads an artist with the catalog’s own disambiguation', () => {
    const [artist] = toArtists({
      artists: [{ id: ARTIST_ID, score: 100, name: 'Paul Simon', disambiguation: 'US singer' }],
    });

    expect(artist).toEqual({
      mbid: ARTIST_ID,
      name: 'Paul Simon',
      disambiguation: 'US singer',
      score: 100,
    });
  });

  it('falls back to the artist type when there is no disambiguation', () => {
    const [artist] = toArtists({ artists: [{ id: ARTIST_ID, name: 'Radiohead', type: 'Group' }] });

    expect(artist?.disambiguation).toBe('Group');
  });

  it('drops an artist with no usable identity', () => {
    expect(toArtists({ artists: [{ id: ARTIST_ID, name: null }, { name: 'No id' }] })).toEqual([]);
  });
});

describe('toRecordings', () => {
  it('reads a track and the release it appears on', () => {
    const [recording] = toRecordings({
      recordings: [
        {
          id: RECORDING_ID,
          score: 88,
          title: 'The Boy in the Bubble',
          'artist-credit': [{ name: 'Paul Simon' }],
          releases: [{ id: RELEASE_ID, title: 'Graceland' }],
        },
      ],
    });

    expect(recording).toEqual({
      mbid: RECORDING_ID,
      title: 'The Boy in the Bubble',
      artistCredit: 'Paul Simon',
      release: { mbid: RELEASE_ID, title: 'Graceland' },
      score: 88,
    });
  });

  it('keeps a recording that names no usable release, marking it as having none', () => {
    const [orphan] = toRecordings({
      recordings: [{ id: RECORDING_ID, title: 'Unreleased', releases: [{ id: 'not-a-uuid' }] }],
    });

    expect(orphan?.release).toBeUndefined();
  });
});

describe('toDiscography', () => {
  it('leads with albums, newest first, so a browse opens on the main body of work', () => {
    const discography = toDiscography({
      'release-groups': [
        { id: RG_ID, title: 'Old Album', 'primary-type': 'Album', 'first-release-date': '1972' },
        { id: RG_ID_2, title: 'A Single', 'primary-type': 'Single', 'first-release-date': '2020' },
        { id: RELEASE_ID, title: 'New Album', 'primary-type': 'Album', 'first-release-date': '1986' },
      ],
    });

    expect(discography.map((group) => group.title)).toEqual(['New Album', 'Old Album', 'A Single']);
  });
});

describe('toEditionListing', () => {
  const official = (id: string, trackCount: number, extras: Record<string, unknown> = {}) => ({
    id,
    title: 'Graceland',
    status: 'Official',
    date: '1986-08-29',
    country: 'DE',
    media: [{ 'track-count': trackCount, format: 'CD' }],
    ...extras,
  });

  it('groups editions by tracklist, most common first, since that is the real choice', () => {
    const listing = toEditionListing({
      releases: [
        official(RELEASE_ID, 11),
        official(RELEASE_ID_2, 19, { date: '2001-01-01' }),
        official(RG_ID, 11, { date: '1986-09-01' }),
      ],
    });

    expect(listing.groups.map((group) => ({ n: group.trackCount, size: group.editions.length }))).toEqual([
      { n: 11, size: 2 },
      { n: 19, size: 1 },
    ]);
  });

  it('presents an edition with what tells it apart from its siblings', () => {
    const listing = toEditionListing({
      releases: [
        official(RELEASE_ID, 11, {
          disambiguation: 'UK limited edition gatefold',
          media: [
            { 'track-count': 8, format: 'CD' },
            { 'track-count': 3, format: 'DVD' },
          ],
        }),
      ],
    });

    expect(listing.groups[0]?.editions[0]).toEqual({
      mbid: RELEASE_ID,
      title: 'Graceland',
      disambiguation: 'UK limited edition gatefold',
      date: '1986-08-29',
      country: 'DE',
      formats: 'CD + DVD',
      status: 'Official',
      trackCount: 11,
    });
  });

  it('names the edition the pipeline itself would pick', () => {
    // Two official 11-track editions: the picker prefers the earliest precisely-dated one.
    const listing = toEditionListing({
      releases: [official(RELEASE_ID_2, 11, { date: '1990-01-01' }), official(RELEASE_ID, 11)],
    });

    expect(listing.bestMatch).toEqual({ kind: 'pick', mbid: RELEASE_ID });
  });

  it('says selection is required when no edition is official, rather than nominating one', () => {
    const listing = toEditionListing({
      releases: [official(RELEASE_ID, 11, { status: 'Bootleg' })],
    });

    expect(listing.bestMatch).toEqual({ kind: 'selectionRequired' });
    expect(listing.groups[0]?.editions).toHaveLength(1);
  });

  it('reads a release group with no editions as an empty listing needing selection', () => {
    expect(toEditionListing({})).toEqual({ groups: [], bestMatch: { kind: 'selectionRequired' } });
  });
});

describe('toTracks', () => {
  it('flattens the media into one running order a person can read', () => {
    const tracks = toTracks({
      id: RELEASE_ID,
      media: [
        { tracks: [{ position: 1, title: 'The Boy in the Bubble', length: 239_000 }] },
        {
          tracks: [
            { position: 2, recording: { title: 'Graceland', length: 290_000 } },
            { title: 'Untimed' },
          ],
        },
      ],
    });

    expect(tracks).toEqual([
      { position: 1, title: 'The Boy in the Bubble', durationMs: 239_000 },
      { position: 2, title: 'Graceland', durationMs: 290_000 },
      { position: 3, title: 'Untimed', durationMs: undefined },
    ]);
  });

  it('reads a release with no media as no tracks', () => {
    expect(toTracks({ id: RELEASE_ID })).toEqual([]);
  });
});
