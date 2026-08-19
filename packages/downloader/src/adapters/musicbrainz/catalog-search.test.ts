import { describe, expect, it } from 'vitest';
import { testScope } from '../../application/__fixtures__/correlation.js';
import { asMbid } from '../../domain/shared/__fixtures__/mbid.js';
import { MusicBrainzCatalogSearch } from './catalog-search.js';
import type { HttpClient, HttpRequest } from '../support/http.js';
import type { Clock } from '../../application/ports/system-ports.js';
import type { InfraError } from '../../application/ports/errors.js';
import type { ResultAsync } from 'neverthrow';

/** Await a port read and take its value — the reads under test are expected to succeed. */
async function unwrap<T>(pending: ResultAsync<T, InfraError>): Promise<T> {
  const result = await pending;
  return result._unsafeUnwrap();
}

/** Await a port read and take its fault, for the paths that are expected to fail. */
async function unwrapErr<T>(pending: ResultAsync<T, InfraError>): Promise<InfraError> {
  const result = await pending;
  return result._unsafeUnwrapErr();
}

const RG_ID = '19847822-1430-3380-9cf1-bc45545b34ac';
const ARTIST_ID = '4d5447d7-c61c-4120-ba1b-d7f471d385b9';
const RECORDING_ID = '0b6b4ba0-d36f-47bd-b4ea-6a5b91842d29';
const RELEASE_ID = '1b022e01-4da6-387b-8658-8678046e4cef';

const GRACELAND = {
  'release-groups': [
    {
      id: RG_ID,
      score: 49,
      title: 'Graceland',
      'first-release-date': '1986-08-25',
      'primary-type': 'Album',
      'artist-credit': [{ name: 'Paul Simon' }],
    },
  ],
};
const PAUL_SIMON = { artists: [{ id: ARTIST_ID, score: 100, name: 'Paul Simon' }] };
const BUBBLE = {
  recordings: [
    {
      id: RECORDING_ID,
      score: 90,
      title: 'The Boy in the Bubble',
      'artist-credit': [{ name: 'Paul Simon' }],
      releases: [{ id: RELEASE_ID, title: 'Graceland' }],
    },
  ],
};

interface Route {
  readonly match: string;
  readonly status?: number;
  readonly json?: unknown;
}

/** A canned HTTP client that records what was asked of it — no live calls in CI. */
function http(routes: readonly Route[]): HttpClient & { readonly sent: HttpRequest[] } {
  const sent: HttpRequest[] = [];
  return {
    sent,
    send(request) {
      sent.push(request);
      const route = routes.find((candidate) => request.url.includes(candidate.match));
      if (route === undefined) return Promise.resolve({ status: 404, body: '' });
      return Promise.resolve({
        status: route.status ?? 200,
        body: JSON.stringify(route.json ?? {}),
      });
    },
  };
}

const SEARCH_ROUTES: readonly Route[] = [
  { match: '/release-group?query=', json: GRACELAND },
  { match: '/artist?query=', json: PAUL_SIMON },
  { match: '/recording?query=', json: BUBBLE },
];

function movableClock(startMs = 1_000_000): Clock & { advance: (ms: number) => void } {
  let current = startMs;
  return {
    now: () => new Date(current),
    advance: (ms: number) => {
      current += ms;
    },
  };
}

function searcher(
  routes: readonly Route[],
  clock: Clock = movableClock(),
): { readonly port: MusicBrainzCatalogSearch; readonly sent: HttpRequest[] } {
  const client = http(routes);
  return {
    port: new MusicBrainzCatalogSearch(
      client,
      { baseUrl: 'https://mb.test/ws/2', userAgent: 'test-agent/1.0', cacheTtlMs: 60_000 },
      clock,
    ),
    sent: client.sent,
  };
}

const queriesOf = (sent: readonly HttpRequest[]): readonly string[] => sent.map((one) => one.url);

describe('MusicBrainzCatalogSearch.search', () => {
  it('answers one query with all three kinds of thing a person might have meant', async () => {
    const { port } = searcher(SEARCH_ROUTES);

    const results = await unwrap(port.search('paul simon graceland', testScope()));

    expect(results.releaseGroups.map((group) => group.title)).toEqual(['Graceland']);
    expect(results.artists.map((artist) => artist.name)).toEqual(['Paul Simon']);
    expect(results.recordings.map((recording) => recording.title)).toEqual([
      'The Boy in the Bubble',
    ]);
  });

  it('says which kind the query was asking about, so a presenter can lead with it', async () => {
    const { port } = searcher(SEARCH_ROUTES);

    const byArtist = await unwrap(port.search('paul simon', testScope()));
    const byAlbum = await unwrap(port.search('paul simon graceland', testScope()));

    expect(byArtist.leading).toBe('artist');
    expect(byAlbum.leading).toBe('release-group');
  });

  it('identifies this application to the catalog on every request', async () => {
    const { port, sent } = searcher(SEARCH_ROUTES);

    await port.search('graceland', testScope());

    expect(sent).not.toHaveLength(0);
    for (const request of sent) {
      expect(request.headers?.['User-Agent']).toBe('test-agent/1.0');
      expect(request.headers?.Accept).toBe('application/json');
    }
  });

  it('asks the catalog nothing at all for a blank query', async () => {
    const { port, sent } = searcher(SEARCH_ROUTES);

    const results = await unwrap(port.search(' '.repeat(3), testScope()));

    expect(results).toEqual({ releaseGroups: [], artists: [], recordings: [], leading: 'release-group' });
    expect(sent).toHaveLength(0);
  });

  it('costs a fixed number of upstream reads however many results come back', async () => {
    const { port, sent } = searcher(SEARCH_ROUTES);

    await port.search('graceland', testScope());

    expect(sent).toHaveLength(3); // one per entity kind — never one per result
  });

  it('serves a repeated search from cache instead of asking the catalog again', async () => {
    const { port, sent } = searcher(SEARCH_ROUTES);

    await port.search('graceland', testScope());
    const repeat = await unwrap(port.search('graceland', testScope()));

    expect(sent).toHaveLength(3);
    expect(repeat.releaseGroups).toHaveLength(1);
  });

  it('shares one upstream read between searches that are in flight together', async () => {
    const { port, sent } = searcher(SEARCH_ROUTES);

    const [first, second] = await Promise.all([
      port.search('graceland', testScope()),
      port.search('graceland', testScope()),
    ]);

    expect(sent).toHaveLength(3);
    expect(first._unsafeUnwrap().releaseGroups).toEqual(second._unsafeUnwrap().releaseGroups);
  });

  it('asks again once the cached answer is stale', async () => {
    const clock = movableClock();
    const { port, sent } = searcher(SEARCH_ROUTES, clock);

    await port.search('graceland', testScope());
    clock.advance(60_001);
    await port.search('graceland', testScope());

    expect(sent).toHaveLength(6);
  });

  it('reports a catalog that refuses the request as an infrastructure fault, not as no matches', async () => {
    const { port } = searcher([{ match: '/release-group?query=', status: 503 }]);

    const failure = await unwrapErr(port.search('graceland', testScope()));

    expect(failure.kind).toBe('InfraError');
    expect(failure.operation).toBe('musicbrainz.catalog.search');
    expect(failure.permanent).toBeUndefined();
  });

  it('reports a catalog whose shape drifted as permanent, since retrying cannot fix it', async () => {
    const { port } = searcher([
      { match: '/release-group?query=', json: { 'release-groups': [{ id: RG_ID, score: 'high' }] } },
      { match: '/artist?query=', json: PAUL_SIMON },
      { match: '/recording?query=', json: BUBBLE },
    ]);

    const failure = await unwrapErr(port.search('graceland', testScope()));

    expect(failure.permanent).toBe(true);
  });
});

describe('MusicBrainzCatalogSearch.lookup', () => {
  it('resolves an identifier that names an album', async () => {
    const { port } = searcher([
      { match: `/release-group/${RG_ID}`, json: { id: RG_ID, title: 'Graceland' } },
    ]);

    const found = await unwrap(port.lookup(asMbid(RG_ID), testScope()));

    expect(found).toMatchObject({
      kind: 'found',
      entity: { kind: 'release-group', releaseGroup: { mbid: RG_ID, title: 'Graceland' } },
    });
  });

  it('falls through the kinds until one answers, so any catalog id can be pasted', async () => {
    const { port } = searcher([
      { match: `/artist/${ARTIST_ID}`, json: { id: ARTIST_ID, name: 'Paul Simon' } },
    ]);

    const found = await unwrap(port.lookup(asMbid(ARTIST_ID), testScope()));

    expect(found).toMatchObject({
      kind: 'found',
      entity: { kind: 'artist', artist: { mbid: ARTIST_ID, name: 'Paul Simon' } },
    });
  });

  it('resolves an identifier that names a track', async () => {
    const { port } = searcher([
      {
        match: `/recording/${RECORDING_ID}`,
        json: { id: RECORDING_ID, title: 'The Boy in the Bubble' },
      },
    ]);

    const found = await unwrap(port.lookup(asMbid(RECORDING_ID), testScope()));

    expect(found).toMatchObject({ kind: 'found', entity: { kind: 'recording' } });
  });

  it('reports an identifier that names nothing as an outcome, not a fault', async () => {
    const { port } = searcher([]);

    const found = await unwrap(port.lookup(asMbid(RG_ID), testScope()));

    expect(found).toEqual({ kind: 'notFound' });
  });
});

describe('MusicBrainzCatalogSearch.discography', () => {
  it('reads an artist’s work with albums first', async () => {
    const { port, sent } = searcher([
      {
        match: `/release-group?artist=${ARTIST_ID}`,
        json: {
          'release-groups': [
            { id: RECORDING_ID, title: 'A Single', 'primary-type': 'Single' },
            { id: RG_ID, title: 'Graceland', 'primary-type': 'Album' },
          ],
        },
      },
    ]);

    const work = await unwrap(port.discography(asMbid(ARTIST_ID), testScope()));

    expect(work.map((group) => group.title)).toEqual(['Graceland', 'A Single']);
    expect(queriesOf(sent)[0]).toContain(`artist=${ARTIST_ID}`);
  });
});

describe('MusicBrainzCatalogSearch.editions', () => {
  it('reads the editions grouped by tracklist with the pipeline’s own default named', async () => {
    const { port } = searcher([
      {
        match: `/release?release-group=${RG_ID}`,
        json: {
          releases: [
            {
              id: RELEASE_ID,
              title: 'Graceland',
              status: 'Official',
              date: '1986-08-29',
              country: 'DE',
              media: [{ 'track-count': 11, format: 'CD' }],
            },
          ],
        },
      },
    ]);

    const listing = await unwrap(port.editions(asMbid(RG_ID), testScope()));

    expect(listing.groups[0]?.trackCount).toBe(11);
    expect(listing.bestMatch).toEqual({ kind: 'pick', mbid: RELEASE_ID });
  });
});

describe('MusicBrainzCatalogSearch.tracklist', () => {
  it('reads one edition’s running order, only when asked for it', async () => {
    const { port, sent } = searcher([
      {
        match: `/release/${RELEASE_ID}`,
        json: { id: RELEASE_ID, media: [{ tracks: [{ position: 1, title: 'Graceland' }] }] },
      },
    ]);

    const tracks = await unwrap(port.tracklist(asMbid(RELEASE_ID), testScope()));

    expect(tracks).toEqual([{ position: 1, title: 'Graceland', durationMs: undefined }]);
    expect(sent).toHaveLength(1);
  });

  it('reads an edition the catalog does not know as no tracks', async () => {
    const { port } = searcher([]);

    expect(await unwrap(port.tracklist(asMbid(RELEASE_ID), testScope()))).toEqual([]);
  });
});
