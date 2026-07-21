import { describe, expect, it } from 'vitest';
import { silentLogger } from '../../application/__fixtures__/fakes.js';
import type { AcquisitionRequest } from '../../domain/acquisition/events.js';
import type { HttpClient, HttpResponse } from '../support/http.js';
import { MusicBrainzMetadata } from './metadata.js';

function ok(json: unknown): HttpResponse {
  return { status: 200, body: JSON.stringify(json) };
}

function http(routes: Array<[string, HttpResponse]>): HttpClient {
  return {
    send: ({ url }) => {
      const hit = routes.find(([match]) => url.includes(match));
      return Promise.resolve(hit ? hit[1] : { status: 404, body: '' });
    },
  };
}

const releaseFixture = (id: string): HttpResponse =>
  ok({
    id,
    title: 'Album',
    date: '2021',
    'artist-credit': [{ name: 'Artist' }],
    media: [{ tracks: [{ position: 1, title: 'T1', length: 1000 }] }],
  });

const recordingFixture = (id: string): HttpResponse =>
  ok({ id, title: 'Song', length: 1000, 'artist-credit': [{ name: 'Artist' }] });

function resolver(routes: Array<[string, HttpResponse]>): MusicBrainzMetadata {
  return new MusicBrainzMetadata(silentLogger(), http(routes));
}

const albumById: AcquisitionRequest = { kind: 'musicbrainz', mbid: 'rel-1', targetType: 'album' };
const trackById: AcquisitionRequest = { kind: 'musicbrainz', mbid: 'rec-1', targetType: 'track' };

describe('MusicBrainzMetadata', () => {
  it('resolves a release by MBID into a canonical target', async () => {
    const result = (
      await resolver([['/release/rel-1', releaseFixture('rel-1')]]).resolve(albumById)
    )._unsafeUnwrap();

    expect(result).toMatchObject({ kind: 'resolved', target: { mbid: 'rel-1', type: 'album' } });
  });

  it('reports unresolved when the release MBID is not found', async () => {
    const result = (await resolver([]).resolve(albumById))._unsafeUnwrap();

    expect(result).toEqual({ kind: 'unresolved' });
  });

  it('reports unresolved when the release cannot form a valid target', async () => {
    const empty = ok({ id: 'rel-1', title: 'Album', 'artist-credit': [{ name: 'Artist' }] });
    const result = (await resolver([['/release/rel-1', empty]]).resolve(albumById))._unsafeUnwrap();

    expect(result).toEqual({ kind: 'unresolved' });
  });

  it('resolves an album descriptor by searching then fetching the best release', async () => {
    const result = (
      await resolver([
        ['/release?query=', ok({ releases: [{ id: 'rel-2', score: 95 }] })],
        ['/release/rel-2', releaseFixture('rel-2')],
      ]).resolve({ kind: 'descriptor', targetType: 'album', artist: 'Artist', title: 'Album' })
    )._unsafeUnwrap();

    expect(result).toMatchObject({ kind: 'resolved', target: { mbid: 'rel-2' } });
  });

  it('reports unresolved when an album search has no confident match', async () => {
    const result = (
      await resolver([['/release?query=', ok({ releases: [] })]]).resolve({
        kind: 'descriptor',
        targetType: 'album',
        artist: 'Artist',
        title: 'Album',
      })
    )._unsafeUnwrap();

    expect(result).toEqual({ kind: 'unresolved' });
  });

  it('reports unresolved when the album identity is ambiguous across release groups', async () => {
    const result = (
      await resolver([
        [
          '/release?query=',
          ok({
            releases: [
              { id: 'a', score: 100, title: 'Album', 'release-group': { id: 'rg-1' } },
              { id: 'b', score: 100, title: 'Album', 'release-group': { id: 'rg-2' } },
            ],
          }),
        ],
      ]).resolve({ kind: 'descriptor', targetType: 'album', artist: 'Artist', title: 'Album' })
    )._unsafeUnwrap();

    expect(result).toEqual({ kind: 'unresolved' });
  });

  it('honors an edition named in the descriptor text', async () => {
    const search = ok({
      releases: [
        {
          id: 'std',
          score: 100,
          title: 'Album',
          status: 'Official',
          date: '2020-01-01',
          'release-group': { id: 'rg' },
        },
        {
          id: 'deluxe',
          score: 100,
          title: 'Album (Deluxe)',
          status: 'Official',
          date: '2020-02-01',
          'release-group': { id: 'rg' },
        },
      ],
    });
    const result = (
      await resolver([
        ['/release?query=', search],
        ['/release/deluxe', releaseFixture('deluxe')],
      ]).resolve({
        kind: 'descriptor',
        targetType: 'album',
        artist: 'Artist',
        title: 'Album (Deluxe)',
      })
    )._unsafeUnwrap();

    expect(result).toMatchObject({ kind: 'resolved', target: { mbid: 'deluxe' } });
  });

  it('falls through to the next release when the canonical pick has unusable data', async () => {
    const search = ok({
      releases: [
        {
          id: 'early',
          score: 100,
          title: 'Album',
          status: 'Official',
          date: '2010',
          'release-group': { id: 'rg' },
        },
        {
          id: 'late',
          score: 100,
          title: 'Album',
          status: 'Official',
          date: '2020',
          'release-group': { id: 'rg' },
        },
      ],
    });
    const sparse = ok({ id: 'early', title: 'Album', 'artist-credit': [{ name: 'Artist' }] });
    const result = (
      await resolver([
        ['/release?query=', search],
        ['/release/early', sparse], // earliest official, but no tracks → no valid target
        ['/release/late', releaseFixture('late')],
      ]).resolve({ kind: 'descriptor', targetType: 'album', artist: 'Artist', title: 'Album' })
    )._unsafeUnwrap();

    expect(result).toMatchObject({ kind: 'resolved', target: { mbid: 'late' } });
  });

  it('reports unresolved when no release in the group yields a valid target', async () => {
    const search = ok({
      releases: [{ id: 'only', score: 100, title: 'Album', 'release-group': { id: 'rg' } }],
    });
    const sparse = ok({ id: 'only', title: 'Album', 'artist-credit': [{ name: 'Artist' }] });
    const result = (
      await resolver([
        ['/release?query=', search],
        ['/release/only', sparse],
      ]).resolve({ kind: 'descriptor', targetType: 'album', artist: 'Artist', title: 'Album' })
    )._unsafeUnwrap();

    expect(result).toEqual({ kind: 'unresolved' });
  });

  it('resolves a recording by MBID into a single-track target', async () => {
    const result = (
      await resolver([['/recording/rec-1', recordingFixture('rec-1')]]).resolve(trackById)
    )._unsafeUnwrap();

    expect(result).toMatchObject({ kind: 'resolved', target: { mbid: 'rec-1', type: 'track' } });
  });

  it('resolves a track descriptor by searching then fetching the best recording', async () => {
    const result = (
      await resolver([
        ['/recording?query=', ok({ recordings: [{ id: 'rec-2', score: 97 }] })],
        ['/recording/rec-2', recordingFixture('rec-2')],
      ]).resolve({ kind: 'descriptor', targetType: 'track', artist: 'Artist', title: 'Song' })
    )._unsafeUnwrap();

    expect(result).toMatchObject({ kind: 'resolved', target: { mbid: 'rec-2', type: 'track' } });
  });

  it('reports unresolved when the recording MBID is not found', async () => {
    const result = (await resolver([]).resolve(trackById))._unsafeUnwrap();

    expect(result).toEqual({ kind: 'unresolved' });
  });

  it('reports unresolved when the recording cannot form a valid target', async () => {
    const noLength = ok({ id: 'rec-1', title: 'Song', 'artist-credit': [{ name: 'Artist' }] });
    const result = (
      await resolver([['/recording/rec-1', noLength]]).resolve(trackById)
    )._unsafeUnwrap();

    expect(result).toEqual({ kind: 'unresolved' });
  });

  it('reports unresolved when a track search has no confident match', async () => {
    const result = (
      await resolver([['/recording?query=', ok({ recordings: [] })]]).resolve({
        kind: 'descriptor',
        targetType: 'track',
        artist: 'Artist',
        title: 'Song',
      })
    )._unsafeUnwrap();

    expect(result).toEqual({ kind: 'unresolved' });
  });

  it('escapes quotes in the descriptor search so a quoted title stays a valid Lucene phrase', async () => {
    const urls: string[] = [];
    const capturing: HttpClient = {
      send: ({ url }) => {
        urls.push(url);
        return Promise.resolve(ok({ releases: [] }));
      },
    };

    await new MusicBrainzMetadata(silentLogger(), capturing).resolve({
      kind: 'descriptor',
      targetType: 'album',
      artist: 'David Bowie',
      title: '"Heroes"',
    });

    const query = new URL(urls[0]!).searchParams.get('query');
    expect(query).toBe('release:"\\"Heroes\\"" AND artist:"David Bowie"');
  });

  it('surfaces an unexpected HTTP status as an InfraError', async () => {
    const result = await resolver([['/release/rel-1', { status: 503, body: '' }]]).resolve(
      albumById,
    );

    expect(result._unsafeUnwrapErr()).toMatchObject({
      kind: 'InfraError',
      operation: 'musicbrainz.resolve',
    });
  });

  it('surfaces a contract-violating 200 response as an InfraError without mapping it', async () => {
    const malformed = ok({ id: 'rel-1', media: 'not-an-array' });
    const result = await resolver([['/release/rel-1', malformed]]).resolve(albumById);

    expect(result._unsafeUnwrapErr()).toMatchObject({
      kind: 'InfraError',
      operation: 'musicbrainz.resolve',
    });
  });
});
