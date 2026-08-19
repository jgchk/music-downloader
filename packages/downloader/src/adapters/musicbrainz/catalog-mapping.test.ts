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
const RELEASE_ID_3 = '723ba05c-98c9-4366-ae79-3c89f8a370ca';

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

  it('drops a hit that cannot be presented or requested — an unaddressable id, or no title', () => {
    const groups = toReleaseGroups({
      'release-groups': [
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

  it('joins a credit the catalog left partly unsaid, without printing its gaps', () => {
    const [group] = toReleaseGroups({
      'release-groups': [
        {
          id: RG_ID,
          title: 'Collaboration',
          'artist-credit': [{ name: 'A', joinphrase: null }, { name: null }, {}],
        },
      ],
    });

    expect(group?.artistCredit).toBe('A');
  });
});

describe('toArtists', () => {
  it('reads an artist with the catalog’s own disambiguation', () => {
    const [artist] = toArtists({
      artists: [
        {
          id: ARTIST_ID,
          score: 100,
          name: 'Paul Simon',
          disambiguation: 'US singer',
          type: 'Person',
        },
      ],
    });

    expect(artist).toEqual({
      mbid: ARTIST_ID,
      name: 'Paul Simon',
      disambiguation: 'US singer',
      type: 'Person',
      score: 100,
    });
  });

  it('carries what kind of act it is separately from the disambiguation', () => {
    // Two different facts about an artist. Collapsing them here would decide, for every reader at
    // once, that a type is a disambiguation — a presentation call the catalog read has no business
    // making, and one that cannot be undone downstream.
    const [artist] = toArtists({ artists: [{ id: ARTIST_ID, name: 'Radiohead', type: 'Group' }] });

    expect(artist?.type).toBe('Group');
    expect(artist?.disambiguation).toBeUndefined();
  });

  it('says nothing about a kind the catalog does not state', () => {
    const [artist] = toArtists({ artists: [{ id: ARTIST_ID, name: 'Nobody' }] });

    expect(artist?.type).toBeUndefined();
  });

  it('drops an artist with no usable identity', () => {
    expect(
      toArtists({
        artists: [
          { id: ARTIST_ID, name: null },
          { id: 'not-a-uuid', name: 'Bad id' },
        ],
      }),
    ).toEqual([]);
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

  it('drops a recording that could not be presented or requested', () => {
    const recordings = toRecordings({
      recordings: [
        { id: 'not-a-uuid', title: 'Bad id' },
        { id: RECORDING_ID, title: null },
        { id: RECORDING_ID, title: 'Keeper' },
      ],
    });

    expect(recordings.map((recording) => recording.title)).toEqual(['Keeper']);
  });

  it('keeps a recording the catalog lists no releases for at all', () => {
    const [orphan] = toRecordings({ recordings: [{ id: RECORDING_ID, title: 'Unreleased' }] });

    expect(orphan?.release).toBeUndefined();
  });

  it('carries a release the catalog has not titled, without inventing a title', () => {
    const [recording] = toRecordings({
      recordings: [{ id: RECORDING_ID, title: 'Song', releases: [{ id: RELEASE_ID }] }],
    });

    expect(recording?.release).toEqual({ mbid: RELEASE_ID, title: '' });
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
        {
          id: RELEASE_ID,
          title: 'New Album',
          'primary-type': 'Album',
          'first-release-date': '1986',
        },
      ],
    });

    expect(discography.map((group) => group.title)).toEqual(['New Album', 'Old Album', 'A Single']);
  });
});

describe('toDiscography (sparse)', () => {
  it('sorts a body of work the catalog has typed and dated only partly', () => {
    const discography = toDiscography({
      'release-groups': [
        { id: RG_ID, title: 'Untyped and undated' },
        { id: RG_ID_2, title: 'Album, undated', 'primary-type': 'Album' },
        {
          id: RELEASE_ID,
          title: 'Album, dated',
          'primary-type': 'Album',
          'first-release-date': '1986',
        },
      ],
    });

    expect(discography.map((group) => group.title)).toEqual([
      'Album, dated',
      'Album, undated',
      'Untyped and undated',
    ]);
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

    expect(
      listing.groups.map((group) => ({
        n: group.representative.trackCount,
        size: group.editions.length,
      })),
    ).toEqual([
      { n: 11, size: 2 },
      { n: 19, size: 1 },
    ]);
  });

  it('names the edition a group is read from, which is the first one that made it', () => {
    const listing = toEditionListing({
      releases: [official(RELEASE_ID, 11), official(RG_ID, 11, { date: '1990-01-01' })],
    });

    expect(listing.groups[0]?.representative.mbid).toBe(RELEASE_ID);
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
      formats: ['CD', 'DVD'],
      status: 'Official',
      trackCount: 11,
    });
  });

  it('presents an edition the catalog has barely described, without inventing details', () => {
    const listing = toEditionListing({
      releases: [{ id: RELEASE_ID, title: null, status: null, date: null, country: null }],
    });

    expect(listing.groups[0]?.editions[0]).toEqual({
      mbid: RELEASE_ID,
      title: '',
      disambiguation: undefined,
      date: undefined,
      country: undefined,
      formats: [],
      status: undefined,
      trackCount: undefined,
    });
  });

  it('orders two equally common tracklists by their length, so the listing is stable', () => {
    const listing = toEditionListing({
      releases: [official(RELEASE_ID, 19), official(RELEASE_ID_2, 11)],
    });

    expect(listing.groups.map((group) => group.representative.trackCount)).toEqual([11, 19]);
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

  it('drops an edition the catalog gives no usable identifier for', () => {
    const listing = toEditionListing({
      releases: [official(RELEASE_ID, 11), { id: 'not-a-uuid', title: 'Unaddressable' }],
    });

    expect(listing.groups.flatMap((group) => group.editions)).toHaveLength(1);
  });

  it('says nothing about formats the catalog does not name', () => {
    const listing = toEditionListing({
      releases: [official(RELEASE_ID, 11, { media: [{ 'track-count': 11, format: null }] })],
    });

    expect(listing.groups[0]?.editions[0]?.formats).toEqual([]);
  });

  it('counts a medium the catalog has not counted as adding no tracks', () => {
    const listing = toEditionListing({
      releases: [official(RELEASE_ID, 11, { media: [{ format: 'CD' }, { 'track-count': 4 }] })],
    });

    expect(listing.groups[0]?.representative.trackCount).toBe(4);
  });

  it('says nothing about the length of an edition the catalog has not counted', () => {
    // Not zero: a pressing the catalog states no count for still has a tracklist, and "0 tracks"
    // both reads as a falsehood and heaps every uncounted pressing into one group.
    const listing = toEditionListing({ releases: [official(RELEASE_ID, 0, { media: undefined })] });

    expect(listing.groups[0]?.representative.trackCount).toBeUndefined();
  });

  it('keeps an uncounted edition out of the group of counted ones', () => {
    const listing = toEditionListing({
      releases: [
        official(RELEASE_ID, 0, { media: undefined }),
        official(RELEASE_ID_2, 11),
        official(RELEASE_ID_3, 11),
      ],
    });

    expect(listing.groups.map((group) => group.representative.trackCount)).toEqual([11, undefined]);
  });

  it('puts a group it cannot describe behind one it can, even when both are equally common', () => {
    // One edition each, so the "most published first" rule cannot decide: what is left is the
    // rule that a group nobody can name a length for must not lead the listing.
    const listing = toEditionListing({
      releases: [official(RELEASE_ID, 0, { media: undefined }), official(RELEASE_ID_2, 11)],
    });

    expect(listing.groups.map((group) => group.representative.trackCount)).toEqual([11, undefined]);
  });

  it('does not let the one edition the catalog says least about become the pick', () => {
    // With one edition each, "most common count" cannot decide — and a sentinel 0 for the
    // uncounted one would WIN the tie-break toward lower counts, sending the download to the
    // pressing MusicBrainz declined to describe.
    const listing = toEditionListing({
      releases: [official(RELEASE_ID, 0, { media: undefined }), official(RELEASE_ID_2, 12)],
    });

    expect(listing.bestMatch).toEqual({ kind: 'pick', mbid: RELEASE_ID_2 });
  });

  it('does not let an uncounted edition become the pipeline’s pick', () => {
    // The presentation says "not stated" while the picker reads the same edition as 0 tracks —
    // a deliberate divergence, and one that must never end with an unknown edition winning.
    const listing = toEditionListing({
      releases: [
        official(RELEASE_ID, 0, { media: undefined }),
        official(RELEASE_ID_2, 11),
        official(RELEASE_ID_3, 11),
      ],
    });

    expect(listing.bestMatch).toEqual({ kind: 'pick', mbid: RELEASE_ID_2 });
  });

  it('drops an edition the catalog names no identifier for', () => {
    // Unlike a search hit, a browsed release may arrive with no id at all — and an edition we
    // cannot address is one we could neither show a tracklist for nor request.
    const listing = toEditionListing({
      releases: [{ title: 'Nameless' }, official(RELEASE_ID, 11)],
    });

    expect(listing.groups.flatMap((group) => group.editions.map((one) => one.mbid))).toEqual([
      RELEASE_ID,
    ]);
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

  it('numbers a multi-disc edition as one running order, not two that both start at 1', () => {
    // MusicBrainz numbers tracks WITHIN a medium, so a two-disc release states 1,2 then 1,2 — and
    // a reader that treats the position as the track's identity sees two tracks numbered 1.
    const tracks = toTracks({
      id: RELEASE_ID,
      media: [
        {
          tracks: [
            { position: 1, title: 'One' },
            { position: 2, title: 'Two' },
          ],
        },
        {
          tracks: [
            { position: 1, title: 'Three' },
            { position: 2, title: 'Four' },
          ],
        },
      ],
    });

    expect(tracks.map((track) => track.position)).toEqual([1, 2, 3, 4]);
    expect(tracks.map((track) => track.title)).toEqual(['One', 'Two', 'Three', 'Four']);
  });

  it('reads a release with no media as no tracks', () => {
    expect(toTracks({ id: RELEASE_ID })).toEqual([]);
  });

  it('reads a medium the catalog lists no tracks for as contributing none', () => {
    expect(toTracks({ id: RELEASE_ID, media: [{}] })).toEqual([]);
  });

  it('reads a track the catalog neither titles nor times', () => {
    expect(toTracks({ id: RELEASE_ID, media: [{ tracks: [{ position: 1 }] }] })).toEqual([
      { position: 1, title: '', durationMs: undefined },
    ]);
  });
});
