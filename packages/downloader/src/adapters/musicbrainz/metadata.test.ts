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

  const byReleaseGroup = (mbid: string): AcquisitionRequest => ({
    kind: 'release-group',
    mbid,
    targetType: 'album',
  });

  const browse = (releases: unknown[]): HttpResponse => ok({ releases });

  it('resolves a release-group request to the modal official edition', async () => {
    const result = (
      await resolver([
        [
          '/release?release-group=rg-1',
          browse([
            // 19-track deluxe must not win over the 13-track standard editions
            {
              id: 'deluxe',
              status: 'Official',
              date: '2014-10-27',
              media: [{ 'track-count': 19 }],
            },
            { id: 'std', status: 'Official', date: '2014-10-27', media: [{ 'track-count': 13 }] },
            { id: 'std2', status: 'Official', date: '2015-01-01', media: [{ 'track-count': 13 }] },
          ]),
        ],
        ['/release/std', releaseFixture('std')],
      ]).resolve(byReleaseGroup('rg-1'))
    )._unsafeUnwrap();

    expect(result).toMatchObject({ kind: 'resolved', target: { mbid: 'std', type: 'album' } });
  });

  it('requests the recorded browse path with inc=media for a release-group request', async () => {
    const urls: string[] = [];
    const capturing: HttpClient = {
      send: ({ url }) => {
        urls.push(url);
        return Promise.resolve(
          url.includes('/release/std')
            ? releaseFixture('std')
            : browse([
                { id: 'std', status: 'Official', date: '2020', media: [{ 'track-count': 10 }] },
              ]),
        );
      },
    };

    await new MusicBrainzMetadata(silentLogger(), capturing).resolve(byReleaseGroup('rg-9'));

    const browseUrl = new URL(urls[0]!);
    expect(browseUrl.searchParams.get('release-group')).toBe('rg-9');
    expect(browseUrl.searchParams.get('inc')).toBe('media');
  });

  it('reports unresolved when the release group is not found', async () => {
    const result = (await resolver([]).resolve(byReleaseGroup('missing')))._unsafeUnwrap();
    expect(result).toEqual({ kind: 'unresolved' });
  });

  it('surfaces the candidate editions for manual selection when the group has no official edition', async () => {
    const result = (
      await resolver([
        [
          '/release?release-group=rg-2',
          browse([
            {
              id: 'boot',
              title: 'Live Bootleg',
              status: 'Bootleg',
              date: '2001',
              country: 'JP',
              media: [{ 'track-count': 12, format: 'CD' }],
            },
          ]),
        ],
      ]).resolve(byReleaseGroup('rg-2'))
    )._unsafeUnwrap();

    expect(result).toEqual({
      kind: 'needsSelection',
      candidates: [
        {
          releaseMbid: 'boot',
          title: 'Live Bootleg',
          date: '2001',
          country: 'JP',
          format: 'CD',
          trackCount: 12,
        },
      ],
    });
  });

  it('reports unresolved (not manual selection) when an official edition exists but yields no target', async () => {
    const sparse = ok({ id: 'off', title: 'Album', 'artist-credit': [{ name: 'Artist' }] });
    const result = (
      await resolver([
        [
          '/release?release-group=rg-5',
          browse([
            { id: 'off', status: 'Official', date: '2010', media: [{ 'track-count': 10 }] },
            { id: 'boot', status: 'Bootleg', date: '2011', media: [{ 'track-count': 10 }] },
          ]),
        ],
        ['/release/off', sparse], // official edition resolves to no valid target
      ]).resolve(byReleaseGroup('rg-5'))
    )._unsafeUnwrap();

    expect(result).toEqual({ kind: 'unresolved' });
  });

  it('tolerates a null-status edition among the browsed releases (prod: Red Headed Stranger)', async () => {
    const result = (
      await resolver([
        [
          '/release?release-group=rg-null',
          browse([
            { id: 'official', status: 'Official', date: '2000', media: [{ 'track-count': 10 }] },
            {
              id: 'mystery',
              title: null,
              status: null,
              date: null,
              media: [{ 'track-count': 10 }],
            },
          ]),
        ],
        ['/release/official', releaseFixture('official')],
      ]).resolve(byReleaseGroup('rg-null'))
    )._unsafeUnwrap();

    expect(result).toMatchObject({ kind: 'resolved', target: { mbid: 'official' } });
  });

  it('reports unresolved when the release group is empty', async () => {
    const result = (
      await resolver([['/release?release-group=rg-3', browse([])]]).resolve(byReleaseGroup('rg-3'))
    )._unsafeUnwrap();

    expect(result).toEqual({ kind: 'unresolved' });
  });

  it('falls through to the next edition when the modal pick has unusable data', async () => {
    const sparse = ok({ id: 'edition-a', title: 'Album', 'artist-credit': [{ name: 'Artist' }] });
    const result = (
      await resolver([
        [
          '/release?release-group=rg-4',
          browse([
            { id: 'edition-a', status: 'Official', date: '2010', media: [{ 'track-count': 13 }] },
            { id: 'edition-b', status: 'Official', date: '2011', media: [{ 'track-count': 13 }] },
          ]),
        ],
        ['/release/edition-a', sparse], // earliest modal edition, but no tracks → no valid target
        ['/release/edition-b', releaseFixture('edition-b')],
      ]).resolve(byReleaseGroup('rg-4'))
    )._unsafeUnwrap();

    expect(result).toMatchObject({ kind: 'resolved', target: { mbid: 'edition-b' } });
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

  // MusicBrainz answers an invalid identifier with `400 {"error":"Invalid mbid."}` — a *permanent*
  // condition that never succeeds on retry. It must be the business outcome `unresolved`, not an
  // InfraError, or the reactor retries it forever and wedges (regression: an invalid mbid stalled
  // resolution in production).
  it('treats a 400 (invalid mbid) on a lookup as unresolved, not a retryable fault', async () => {
    const result = (
      await resolver([
        ['/release/rel-1', { status: 400, body: '{"error":"Invalid mbid."}' }],
      ]).resolve(albumById)
    )._unsafeUnwrap();

    expect(result).toEqual({ kind: 'unresolved' });
  });

  it('treats a 400 (invalid mbid) on the release-group browse as unresolved', async () => {
    const result = (
      await resolver([
        ['/release?release-group=bad', { status: 400, body: '{"error":"Invalid mbid."}' }],
      ]).resolve(byReleaseGroup('bad'))
    )._unsafeUnwrap();

    expect(result).toEqual({ kind: 'unresolved' });
  });

  // A 400 on a *search* means MusicBrainz rejected a Lucene query WE constructed — an adapter
  // defect, not "no result". It must surface as an attributable InfraError, never be swallowed as
  // silently unresolved (which would hide a query-construction bug behind a clean no-match).
  it('surfaces a 400 on an album descriptor search as an InfraError (query-construction defect)', async () => {
    const result = await resolver([['/release?query=', { status: 400, body: '' }]]).resolve({
      kind: 'descriptor',
      targetType: 'album',
      artist: 'Artist',
      title: 'Album',
    });

    expect(result._unsafeUnwrapErr()).toMatchObject({
      kind: 'InfraError',
      operation: 'musicbrainz.resolve',
    });
  });

  it('surfaces a 400 on a track descriptor search as an InfraError (query-construction defect)', async () => {
    const result = await resolver([['/recording?query=', { status: 400, body: '' }]]).resolve({
      kind: 'descriptor',
      targetType: 'track',
      artist: 'Artist',
      title: 'Song',
    });

    expect(result._unsafeUnwrapErr()).toMatchObject({
      kind: 'InfraError',
      operation: 'musicbrainz.resolve',
    });
  });
});
