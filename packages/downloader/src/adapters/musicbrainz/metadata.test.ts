import { testScope } from '../../application/__fixtures__/correlation.js';
import { describe, expect, it, vi } from 'vitest';
import { silentLogger } from '../../application/__fixtures__/fakes.js';
import type { DownloadRequest } from '../../domain/download/events.js';
import { asMbid } from '../../domain/shared/__fixtures__/mbid.js';
import type { HttpClient, HttpResponse } from '../support/http.js';
import { MusicBrainzMetadata } from './metadata.js';

function ok(json: unknown): HttpResponse {
  return { status: 200, body: JSON.stringify(json) };
}

function http(routes: [string, HttpResponse][]): HttpClient {
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

/**
 * A deterministic, UUID-shaped MusicBrainz id from a readable seed. The ACL now parses MB ids as
 * UUIDs, so a *fetched* release/recording body's `id` (the value that becomes the target's `mbid`)
 * must be well-formed; request mbids, search-hit selection ids, and route keys are unvalidated and
 * stay plain. The seed keeps intent legible.
 */
function uuid(seed: string): string {
  // `Array.from` with a map fn rather than a mapped spread: same string-iterator walk, one pass,
  // and it is the form the lint profile prefers. The seeds are ASCII literals either way.
  const hex = Array.from(seed, (character) =>
    character.codePointAt(0)!.toString(16).padStart(2, '0'),
  )
    .join('')
    .padEnd(32, '0')
    .slice(0, 32);
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20, 32)}`;
}

function resolver(routes: [string, HttpResponse][]): MusicBrainzMetadata {
  return new MusicBrainzMetadata(http(routes));
}

const albumById: DownloadRequest = {
  kind: 'musicbrainz',
  mbid: asMbid('rel-1'),
  targetType: 'album',
};
const trackById: DownloadRequest = {
  kind: 'musicbrainz',
  mbid: asMbid('rec-1'),
  targetType: 'track',
};

describe('MusicBrainzMetadata', () => {
  it('resolves a release by MBID into a canonical target', async () => {
    const resolveResult = await resolver([
      ['/release/rel-1', releaseFixture(uuid('rel-1'))],
    ]).resolve(albumById, testScope());
    const result = resolveResult._unsafeUnwrap();

    expect(result).toMatchObject({
      kind: 'resolved',
      target: { mbid: uuid('rel-1'), type: 'album' },
    });
  });

  it('reports unresolved when the release MBID is not found', async () => {
    const resolveResult2 = await resolver([]).resolve(albumById, testScope());
    const result = resolveResult2._unsafeUnwrap();

    expect(result).toEqual({ kind: 'unresolved' });
  });

  it('reports unresolved when the release cannot form a valid target', async () => {
    const empty = ok({ id: 'rel-1', title: 'Album', 'artist-credit': [{ name: 'Artist' }] });
    const resolveResult3 = await resolver([['/release/rel-1', empty]]).resolve(
      albumById,
      testScope(),
    );
    const result = resolveResult3._unsafeUnwrap();

    expect(result).toEqual({ kind: 'unresolved' });
  });

  it('resolves an album descriptor by searching then fetching the best release', async () => {
    const resolveResult4 = await resolver([
      ['/release?query=', ok({ releases: [{ id: 'rel-2', score: 95 }] })],
      ['/release/rel-2', releaseFixture(uuid('rel-2'))],
    ]).resolve(
      { kind: 'descriptor', targetType: 'album', artist: 'Artist', title: 'Album' },
      testScope(),
    );
    const result = resolveResult4._unsafeUnwrap();

    expect(result).toMatchObject({ kind: 'resolved', target: { mbid: uuid('rel-2') } });
  });

  it('reports unresolved when an album search has no confident match', async () => {
    const resolveResult5 = await resolver([['/release?query=', ok({ releases: [] })]]).resolve(
      {
        kind: 'descriptor',
        targetType: 'album',
        artist: 'Artist',
        title: 'Album',
      },
      testScope(),
    );
    const result = resolveResult5._unsafeUnwrap();

    expect(result).toEqual({ kind: 'unresolved' });
  });

  it('treats a 404 from the album search as no results at all', async () => {
    const resolveResult25 = await resolver([]).resolve(
      { kind: 'descriptor', targetType: 'album', artist: 'Artist', title: 'Album' },
      testScope(),
    );
    const result = resolveResult25._unsafeUnwrap();

    expect(result).toEqual({ kind: 'unresolved' });
  });

  it('reports unresolved when the album identity is ambiguous across release groups', async () => {
    const resolveResult6 = await resolver([
      [
        '/release?query=',
        ok({
          releases: [
            { id: 'a', score: 100, title: 'Album', 'release-group': { id: 'rg-1' } },
            { id: 'b', score: 100, title: 'Album', 'release-group': { id: 'rg-2' } },
          ],
        }),
      ],
    ]).resolve(
      { kind: 'descriptor', targetType: 'album', artist: 'Artist', title: 'Album' },
      testScope(),
    );
    const result = resolveResult6._unsafeUnwrap();

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
    const resolveResult7 = await resolver([
      ['/release?query=', search],
      ['/release/deluxe', releaseFixture(uuid('deluxe'))],
    ]).resolve(
      {
        kind: 'descriptor',
        targetType: 'album',
        artist: 'Artist',
        title: 'Album (Deluxe)',
      },
      testScope(),
    );
    const result = resolveResult7._unsafeUnwrap();

    expect(result).toMatchObject({ kind: 'resolved', target: { mbid: uuid('deluxe') } });
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
    const resolveResult8 = await resolver([
      ['/release?query=', search],
      ['/release/early', sparse], // earliest official, but no tracks → no valid target
      ['/release/late', releaseFixture(uuid('late'))],
    ]).resolve(
      { kind: 'descriptor', targetType: 'album', artist: 'Artist', title: 'Album' },
      testScope(),
    );
    const result = resolveResult8._unsafeUnwrap();

    expect(result).toMatchObject({ kind: 'resolved', target: { mbid: uuid('late') } });
  });

  it('reports unresolved when no release in the group yields a valid target', async () => {
    const search = ok({
      releases: [{ id: 'only', score: 100, title: 'Album', 'release-group': { id: 'rg' } }],
    });
    const sparse = ok({ id: 'only', title: 'Album', 'artist-credit': [{ name: 'Artist' }] });
    const resolveResult9 = await resolver([
      ['/release?query=', search],
      ['/release/only', sparse],
    ]).resolve(
      { kind: 'descriptor', targetType: 'album', artist: 'Artist', title: 'Album' },
      testScope(),
    );
    const result = resolveResult9._unsafeUnwrap();

    expect(result).toEqual({ kind: 'unresolved' });
  });

  const byReleaseGroup = (mbid: string): DownloadRequest => ({
    kind: 'release-group',
    mbid: asMbid(mbid),
    targetType: 'album',
  });

  const browse = (releases: unknown[]): HttpResponse => ok({ releases });

  it('resolves a release-group request to the modal official edition', async () => {
    const resolveResult10 = await resolver([
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
      ['/release/std', releaseFixture(uuid('std'))],
    ]).resolve(byReleaseGroup('rg-1'), testScope());
    const result = resolveResult10._unsafeUnwrap();

    expect(result).toMatchObject({
      kind: 'resolved',
      target: { mbid: uuid('std'), type: 'album' },
    });
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

    await new MusicBrainzMetadata(capturing).resolve(byReleaseGroup('rg-9'), testScope());

    const browseUrl = new URL(urls[0]!);
    expect(browseUrl.searchParams.get('release-group')).toBe('rg-9');
    expect(browseUrl.searchParams.get('inc')).toBe('media');
  });

  it('reports unresolved when the release group is not found', async () => {
    const resolveResult11 = await resolver([]).resolve(byReleaseGroup('missing'), testScope());
    const result = resolveResult11._unsafeUnwrap();
    expect(result).toEqual({ kind: 'unresolved' });
  });

  it('surfaces the candidate editions for manual selection when the group has no official edition', async () => {
    const resolveResult12 = await resolver([
      [
        '/release?release-group=rg-2',
        browse([
          {
            id: uuid('boot'),
            title: 'Live Bootleg',
            status: 'Bootleg',
            date: '2001',
            country: 'JP',
            media: [{ 'track-count': 12, format: 'CD' }],
          },
        ]),
      ],
    ]).resolve(byReleaseGroup('rg-2'), testScope());
    const result = resolveResult12._unsafeUnwrap();

    expect(result).toEqual({
      kind: 'needsSelection',
      candidates: [
        {
          releaseMbid: uuid('boot'),
          title: 'Live Bootleg',
          date: '2001',
          country: 'JP',
          format: 'CD',
          trackCount: 12,
        },
      ],
    });
  });

  // The bootleg here is a *selectable* edition (a well-formed mbid): manual selection is scoped to
  // groups with no official edition, so the existence of an official one keeps this unresolved even
  // though a candidate could have been offered.
  it('reports unresolved (not manual selection) when an official edition exists but yields no target', async () => {
    const sparse = ok({ id: uuid('off'), title: 'Album', 'artist-credit': [{ name: 'Artist' }] });
    const logger = silentLogger();
    const warnSpy = vi.spyOn(logger, 'warn');
    const routes: [string, HttpResponse][] = [
      [
        '/release?release-group=rg-5',
        browse([
          { id: uuid('off'), status: 'Official', date: '2010', media: [{ 'track-count': 10 }] },
          { id: uuid('boot'), status: 'Bootleg', date: '2011', media: [{ 'track-count': 10 }] },
        ]),
      ],
      [`/release/${uuid('off')}`, sparse], // official edition resolves to no valid target
    ];
    // The adapter logs through the scope's logger, so the spied logger is handed in on the scope.
    const resolveResult13 = await new MusicBrainzMetadata(http(routes)).resolve(
      byReleaseGroup('rg-5'),
      { ...testScope(), logger },
    );
    const result = resolveResult13._unsafeUnwrap();

    expect(result).toEqual({ kind: 'unresolved' });
    // the dropped editions leave no other trace, so the warning naming what was tried is the
    // operator's only record of why a group with editions resolved to nothing
    expect(warnSpy).toHaveBeenCalledWith(
      expect.objectContaining({ releaseGroup: 'rg-5', tried: [uuid('off')] }),
      expect.stringContaining('no usable target'),
    );
  });

  it('tolerates a null-status edition among the browsed releases (prod: Red Headed Stranger)', async () => {
    const resolveResult14 = await resolver([
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
      ['/release/official', releaseFixture(uuid('official'))],
    ]).resolve(byReleaseGroup('rg-null'), testScope());
    const result = resolveResult14._unsafeUnwrap();

    expect(result).toMatchObject({ kind: 'resolved', target: { mbid: uuid('official') } });
  });

  it('reports unresolved when the release group is empty', async () => {
    const resolveResult15 = await resolver([['/release?release-group=rg-3', browse([])]]).resolve(
      byReleaseGroup('rg-3'),
      testScope(),
    );
    const result = resolveResult15._unsafeUnwrap();

    expect(result).toEqual({ kind: 'unresolved' });
  });

  it('falls through to the next edition when the modal pick has unusable data', async () => {
    const sparse = ok({ id: 'edition-a', title: 'Album', 'artist-credit': [{ name: 'Artist' }] });
    const resolveResult16 = await resolver([
      [
        '/release?release-group=rg-4',
        browse([
          { id: 'edition-a', status: 'Official', date: '2010', media: [{ 'track-count': 13 }] },
          { id: 'edition-b', status: 'Official', date: '2011', media: [{ 'track-count': 13 }] },
        ]),
      ],
      ['/release/edition-a', sparse], // earliest modal edition, but no tracks → no valid target
      ['/release/edition-b', releaseFixture(uuid('edition-b'))],
    ]).resolve(byReleaseGroup('rg-4'), testScope());
    const result = resolveResult16._unsafeUnwrap();

    expect(result).toMatchObject({ kind: 'resolved', target: { mbid: uuid('edition-b') } });
  });

  it('resolves a recording by MBID into a single-track target', async () => {
    const resolveResult17 = await resolver([
      ['/recording/rec-1', recordingFixture(uuid('rec-1'))],
    ]).resolve(trackById, testScope());
    const result = resolveResult17._unsafeUnwrap();

    expect(result).toMatchObject({
      kind: 'resolved',
      target: { mbid: uuid('rec-1'), type: 'track' },
    });
  });

  it('resolves a track descriptor by searching then fetching the best recording', async () => {
    const resolveResult18 = await resolver([
      ['/recording?query=', ok({ recordings: [{ id: 'rec-2', score: 97 }] })],
      ['/recording/rec-2', recordingFixture(uuid('rec-2'))],
    ]).resolve(
      { kind: 'descriptor', targetType: 'track', artist: 'Artist', title: 'Song' },
      testScope(),
    );
    const result = resolveResult18._unsafeUnwrap();

    expect(result).toMatchObject({
      kind: 'resolved',
      target: { mbid: uuid('rec-2'), type: 'track' },
    });
  });

  it('reports unresolved when the recording MBID is not found', async () => {
    const resolveResult19 = await resolver([]).resolve(trackById, testScope());
    const result = resolveResult19._unsafeUnwrap();

    expect(result).toEqual({ kind: 'unresolved' });
  });

  it('reports unresolved when the recording cannot form a valid target', async () => {
    const noLength = ok({ id: 'rec-1', title: 'Song', 'artist-credit': [{ name: 'Artist' }] });
    const resolveResult20 = await resolver([['/recording/rec-1', noLength]]).resolve(
      trackById,
      testScope(),
    );
    const result = resolveResult20._unsafeUnwrap();

    expect(result).toEqual({ kind: 'unresolved' });
  });

  it('reports unresolved when a track search has no confident match', async () => {
    const resolveResult21 = await resolver([['/recording?query=', ok({ recordings: [] })]]).resolve(
      {
        kind: 'descriptor',
        targetType: 'track',
        artist: 'Artist',
        title: 'Song',
      },
      testScope(),
    );
    const result = resolveResult21._unsafeUnwrap();

    expect(result).toEqual({ kind: 'unresolved' });
  });

  it('treats a 404 from the recording search as no results at all', async () => {
    const resolveResult26 = await resolver([]).resolve(
      { kind: 'descriptor', targetType: 'track', artist: 'Artist', title: 'Song' },
      testScope(),
    );
    const result = resolveResult26._unsafeUnwrap();

    expect(result).toEqual({ kind: 'unresolved' });
  });

  it('sends no lookup when the track search yields no confident match', async () => {
    const urls: string[] = [];
    const capturing: HttpClient = {
      send: ({ url }) => {
        urls.push(url);
        return Promise.resolve(ok({ recordings: [{ id: 'rec-9', score: 50 }] }));
      },
    };

    const result = await new MusicBrainzMetadata(capturing).resolve(
      { kind: 'descriptor', targetType: 'track', artist: 'Artist', title: 'Song' },
      testScope(),
    );

    expect(result._unsafeUnwrap()).toEqual({ kind: 'unresolved' });
    // MusicBrainz is rate-limited: an unmatched search must cost one request, not two
    expect(urls).toHaveLength(1);
  });

  it('escapes quotes in the descriptor search so a quoted title stays a valid Lucene phrase', async () => {
    const urls: string[] = [];
    const capturing: HttpClient = {
      send: ({ url }) => {
        urls.push(url);
        return Promise.resolve(ok({ releases: [] }));
      },
    };

    await new MusicBrainzMetadata(capturing).resolve(
      {
        kind: 'descriptor',
        targetType: 'album',
        artist: 'David Bowie',
        title: '"Heroes"',
      },
      testScope(),
    );

    const query = new URL(urls[0]!).searchParams.get('query');
    expect(query).toBe(String.raw`release:"\"Heroes\"" AND artist:"David Bowie"`);
  });

  // Every status outside 2xx that is not one of the two modelled business answers (404 not found,
  // 400 invalid mbid on a lookup) is an infrastructure fault naming the status — the body is never
  // parsed on the strength of a non-success status, so each case carries a *well-formed* body and
  // the status alone is what makes it fail.
  it.each([199, 300, 503])(
    'surfaces HTTP %i as an InfraError naming the status instead of mapping the body',
    async (status) => {
      const body = releaseFixture(uuid('rel-1')).body;
      const result = await resolver([['/release/rel-1', { status, body }]]).resolve(
        albumById,
        testScope(),
      );

      const fault = result._unsafeUnwrapErr();
      expect(fault).toMatchObject({ kind: 'InfraError', operation: 'musicbrainz.resolve' });
      expect(fault.message).toContain(`MusicBrainz responded ${status}`);
    },
  );

  it('surfaces a contract-violating 200 response as an InfraError without mapping it', async () => {
    const malformed = ok({ id: 'rel-1', media: 'not-an-array' });
    const result = await resolver([['/release/rel-1', malformed]]).resolve(albumById, testScope());

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
    const resolveResult22 = await resolver([
      ['/release/rel-1', { status: 400, body: '{"error":"Invalid mbid."}' }],
    ]).resolve(albumById, testScope());
    const result = resolveResult22._unsafeUnwrap();

    expect(result).toEqual({ kind: 'unresolved' });
  });

  it('treats a 400 (invalid mbid) on a recording lookup as unresolved, not a retryable fault', async () => {
    const resolveResult24 = await resolver([
      ['/recording/rec-1', { status: 400, body: '{"error":"Invalid mbid."}' }],
    ]).resolve(trackById, testScope());
    const result = resolveResult24._unsafeUnwrap();

    expect(result).toEqual({ kind: 'unresolved' });
  });

  it('treats a 400 (invalid mbid) on the release-group browse as unresolved', async () => {
    const resolveResult23 = await resolver([
      ['/release?release-group=bad', { status: 400, body: '{"error":"Invalid mbid."}' }],
    ]).resolve(byReleaseGroup('bad'), testScope());
    const result = resolveResult23._unsafeUnwrap();

    expect(result).toEqual({ kind: 'unresolved' });
  });

  // A 400 on a *search* means MusicBrainz rejected a Lucene query WE constructed — an adapter
  // defect, not "no result". It must surface as an attributable InfraError, never be swallowed as
  // silently unresolved (which would hide a query-construction bug behind a clean no-match).
  it('surfaces a 400 on an album descriptor search as an InfraError (query-construction defect)', async () => {
    const result = await resolver([['/release?query=', { status: 400, body: '' }]]).resolve(
      {
        kind: 'descriptor',
        targetType: 'album',
        artist: 'Artist',
        title: 'Album',
      },
      testScope(),
    );

    expect(result._unsafeUnwrapErr()).toMatchObject({
      kind: 'InfraError',
      operation: 'musicbrainz.resolve',
    });
  });

  it('surfaces a 400 on a track descriptor search as an InfraError (query-construction defect)', async () => {
    const result = await resolver([['/recording?query=', { status: 400, body: '' }]]).resolve(
      {
        kind: 'descriptor',
        targetType: 'track',
        artist: 'Artist',
        title: 'Song',
      },
      testScope(),
    );

    expect(result._unsafeUnwrapErr()).toMatchObject({
      kind: 'InfraError',
      operation: 'musicbrainz.resolve',
    });
  });
});
