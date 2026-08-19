import { describe, expect, it } from 'vitest';
import { createLogger } from '../../application/logging/logger.js';
import { testContext, testScope } from '../../application/__fixtures__/correlation.js';
import { asMbid } from '../../domain/shared/__fixtures__/mbid.js';
import { MusicBrainzCatalogSearch } from './catalog-search.js';
import type { HttpClient, HttpRequest } from '../support/http.js';
import type { OperationScope } from '../../application/correlation/context.js';
import type { InfraError } from '../../application/ports/errors.js';
import type { ResultAsync } from 'neverthrow';

/**
 * A scope whose warnings the test can read. Drift is only ever OBSERVABLE as a log line — the
 * answer itself looks like an ordinary empty one — so a test that does not read the lines cannot
 * tell the two apart either.
 */
function watchedScope(): { readonly scope: OperationScope; readonly warnings: string[] } {
  const warnings: string[] = [];
  const logger = createLogger({
    level: 'warn',
    destination: { write: (line: string) => void warnings.push(line) },
  });
  return { scope: { context: testContext(), logger }, warnings };
}

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

function searcher(routes: readonly Route[]): {
  readonly port: MusicBrainzCatalogSearch;
  readonly sent: HttpRequest[];
} {
  const client = http(routes);
  return {
    port: new MusicBrainzCatalogSearch(client, {
      baseUrl: 'https://mb.test/ws/2',
      userAgent: 'test-agent/1.0',
    }),
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

    expect(results).toEqual({
      releaseGroups: [],
      artists: [],
      recordings: [],
      leading: 'release-group',
      unavailable: [],
    });
    expect(sent).toHaveLength(0);
  });

  it('costs a fixed number of upstream reads however many results come back', async () => {
    const { port, sent } = searcher(SEARCH_ROUTES);

    await port.search('graceland', testScope());

    expect(sent).toHaveLength(3); // one per entity kind — never one per result
  });

  it('keeps the kinds that answered when one of the three could not be read', async () => {
    // One 503 out of three reads is a hole in the answer, not the end of it: the albums that came
    // back are still the albums, and discarding them answers a question nobody asked.
    const { port } = searcher([
      { match: '/release-group?query=', json: GRACELAND },
      { match: '/artist?query=', status: 503 },
      { match: '/recording?query=', json: BUBBLE },
    ]);

    const results = await unwrap(port.search('paul simon graceland', testScope()));

    expect(results.releaseGroups.map((group) => group.title)).toEqual(['Graceland']);
    expect(results.artists).toEqual([]);
    expect(results.unavailable).toEqual([{ kind: 'artist', reason: 'unreachable' }]);
  });

  it('says out loud which kinds it could not read', async () => {
    const { port } = searcher([
      { match: '/release-group?query=', json: GRACELAND },
      { match: '/artist?query=', status: 503 },
      { match: '/recording?query=', json: BUBBLE },
    ]);
    const watched = watchedScope();

    await unwrap(port.search('graceland', watched.scope));

    // WITH the fault: the operation and status are the whole diagnosis, and below this line they
    // are gone — a permanent drift would otherwise leave one line naming a kind and nothing else.
    const [line] = watched.warnings;
    expect(JSON.parse(line!)).toMatchObject({
      unavailable: [{ kind: 'artist', reason: 'unreachable' }],
      faults: [{ operation: 'musicbrainz.catalog.search.artist' }],
    });
  });

  it('reports a search whose every read failed as a fault, not as an answer with three holes', async () => {
    const { port } = searcher([
      { match: '/release-group?query=', status: 503 },
      { match: '/artist?query=', status: 503 },
      { match: '/recording?query=', status: 503 },
    ]);

    const failure = await unwrapErr(port.search('graceland', testScope()));

    expect(failure.kind).toBe('InfraError');
  });

  it('reports a catalog that refuses the request as an infrastructure fault, not as no matches', async () => {
    // Every read refused: one refusal is a hole in the answer (see the partial cases above), while
    // all three is the catalog itself being unavailable.
    const { port } = searcher([{ match: '?query=', status: 503 }]);

    const failure = await unwrapErr(port.search('graceland', testScope()));

    expect(failure.kind).toBe('InfraError');
    // Named per entity: an operator must be able to tell WHICH of a search's three reads failed.
    expect(failure.operation).toBe('musicbrainz.catalog.search.release-group');
    expect(failure.permanent).toBeUndefined();
  });

  it('reads a catalog that holds none of what was asked as empty, not as a fault', async () => {
    // Every entity read 404s: the catalog saying "no such thing" is an answer.
    const { port } = searcher([]);

    const results = await unwrap(port.search('nothing at all', testScope()));

    expect(results).toEqual({
      releaseGroups: [],
      artists: [],
      recordings: [],
      leading: 'release-group',
      unavailable: [],
    });
  });

  it('searches for what was typed as words, not as query syntax', async () => {
    const { port, sent } = searcher(SEARCH_ROUTES);

    await unwrap(port.search("sgt. pepper's: live", testScope()));

    // The provider parses this parameter as a query language; a searcher's punctuation must read
    // as punctuation rather than as syntax it would refuse.
    const query = new URL(sent[0]!.url).searchParams.get('query');
    expect(query).toContain(String.raw`\:`);
  });

  it('searches for text no URL encoder will take, rather than throwing on the way out', async () => {
    // A lone surrogate reaches `encodeURIComponent` as a URIError — a throw escaping a method that
    // promises a Result. The search box admits any text at all, so it must survive any text.
    const { port, sent } = searcher(SEARCH_ROUTES);

    const results = await unwrap(port.search('grace\u{D800}land', testScope()));

    expect(results.releaseGroups).toHaveLength(1);
    expect(sent).toHaveLength(3);
  });

  it.each([[429], [408]])(
    'reports a %d as a passing fault, since it is the catalog asking for later, not never',
    async (status) => {
      const { port } = searcher([{ match: '?query=', status }]);

      const failure = await unwrapErr(port.search('graceland', testScope()));

      expect(failure.permanent).toBeFalsy();
    },
  );

  it('reports a request the catalog refuses as permanent, since retrying reproduces it', async () => {
    const { port } = searcher([{ match: '?query=', status: 400 }]);

    const failure = await unwrapErr(port.search('graceland', testScope()));

    expect(failure.permanent).toBe(true);
  });

  it('reports a catalog that could not be reached at all as a fault', async () => {
    const port = new MusicBrainzCatalogSearch(
      { send: () => Promise.reject(new Error('connection reset')) },
      { baseUrl: 'https://mb.test/ws/2', userAgent: 'test-agent/1.0' },
    );

    const failure = await unwrapErr(port.search('graceland', testScope()));

    expect(failure.message).toContain('could not be reached');
  });

  it('reports a catalog that answers with something other than JSON as permanent', async () => {
    const notJson: HttpClient = {
      send: () => Promise.resolve({ status: 200, body: '<html>maintenance</html>' }),
    };
    const port = new MusicBrainzCatalogSearch(notJson, { baseUrl: 'https://mb.test/ws/2' });

    const failure = await unwrapErr(port.search('graceland', testScope()));

    expect(failure.permanent).toBe(true);
  });

  it('reads an answer whose fields are the wrong type as a kind it could not read', async () => {
    const { port } = searcher([
      {
        match: '/release-group?query=',
        json: { 'release-groups': [{ id: RG_ID, score: 'high' }] },
      },
      { match: '/artist?query=', json: PAUL_SIMON },
      { match: '/recording?query=', json: BUBBLE },
    ]);

    const results = await unwrap(port.search('graceland', testScope()));

    expect(results.unavailable).toEqual([{ kind: 'release-group', reason: 'unreadable' }]);
    expect(results.artists).toHaveLength(1);
  });
});

describe('MusicBrainzCatalogSearch and a catalog that has drifted', () => {
  it.each([
    ['release-group', { 'release-groups': [{ title: 'Graceland' }] }, undefined, undefined],
    ['artist', undefined, { artists: [{ name: 'Paul Simon' }] }, undefined],
    ['recording', undefined, undefined, { recordings: [{ title: 'The Boy in the Bubble' }] }],
  ])(
    'reads a %s answer whose hits carry no identifier as a kind it could not read',
    async (kind, groups, artists, recordings) => {
      // A renamed `id` parses clean under a tolerant reader and empties that block silently. An
      // identifier is the one field a hit cannot be shown without, so its absence is drift — and
      // the block it drifted in is reported as unread rather than rendered as "nothing matched".
      const { port } = searcher([
        { match: '/release-group?query=', json: groups ?? GRACELAND },
        { match: '/artist?query=', json: artists ?? PAUL_SIMON },
        { match: '/recording?query=', json: recordings ?? BUBBLE },
      ]);

      const results = await unwrap(port.search('graceland', testScope()));

      // Drift, not unreachability: the catalog answered, in a shape this application cannot read.
      expect(results.unavailable).toEqual([{ kind, reason: 'unreadable' }]);
    },
  );

  it('reports a catalog whose every answer has drifted as a permanent fault', async () => {
    const { port } = searcher([
      {
        match: '?query=',
        json: { 'release-groups': 'not-a-list', artists: 'not-a-list', recordings: 'not-a-list' },
      },
    ]);

    const failure = await unwrapErr(port.search('graceland', testScope()));

    expect(failure.permanent).toBe(true);
  });

  it('says out loud when the catalog answered with hits it could present none of', async () => {
    // Every id well-formed, every TITLE gone: tolerable field by field, and yet the page would
    // say "Nothing matched" for a query the catalog answered 3 hits to.
    const { port } = searcher([
      {
        match: '/release-group?query=',
        json: { 'release-groups': [{ id: RG_ID, score: 49, title: null }] },
      },
      { match: '/artist?query=', json: { artists: [{ id: ARTIST_ID, score: 100, name: null }] } },
      {
        match: '/recording?query=',
        json: { recordings: [{ id: RECORDING_ID, score: 90, title: null }] },
      },
    ]);
    const watched = watchedScope();

    const results = await unwrap(port.search('graceland', watched.scope));

    expect(results.releaseGroups).toHaveLength(0);
    expect(watched.warnings.join('')).toContain(
      'catalog answered with hits none of which could be presented',
    );
  });

  it('names which of the three reads it could present nothing from', async () => {
    // The operator's actual question is "what drifted"; a warning that always names all three
    // answers it no better than one that names none.
    const { port } = searcher([
      { match: '/release-group?query=', json: GRACELAND },
      { match: '/artist?query=', json: { artists: [{ id: ARTIST_ID, score: 100, name: null }] } },
      { match: '/recording?query=', json: BUBBLE },
    ]);
    const watched = watchedScope();

    await unwrap(port.search('graceland', watched.scope));

    const [line] = watched.warnings;
    expect(JSON.parse(line!)).toMatchObject({ emptied: ['artists'] });
  });

  it('stays quiet when a query genuinely matches nothing', async () => {
    const { port } = searcher([
      { match: '/release-group?query=', json: { 'release-groups': [] } },
      { match: '/artist?query=', json: { artists: [] } },
      { match: '/recording?query=', json: { recordings: [] } },
    ]);
    const watched = watchedScope();

    await unwrap(port.search('asdfghjkl', watched.scope));

    expect(watched.warnings).toEqual([]);
  });

  it('says out loud when a release group’s editions could none of them be presented', async () => {
    const { port } = searcher([
      { match: '/release?release-group=', json: { releases: [{ id: 'not-a-uuid' }] } },
    ]);
    const watched = watchedScope();

    const listing = await unwrap(port.editions(asMbid(RG_ID), watched.scope));

    expect(listing.groups).toEqual([]);
    expect(watched.warnings.join('')).toContain(
      'catalog listed editions none of which could be presented',
    );
  });
});

describe('MusicBrainzCatalogSearch.lookup', () => {
  it.each([
    ['release-group', RG_ID, 'catalog release group could not be presented'],
    ['artist', ARTIST_ID, 'catalog artist could not be presented'],
    ['recording', RECORDING_ID, 'catalog recording could not be presented'],
  ])('says when the catalog answered about a %s it could not present', async (kind, mbid, said) => {
    // A 200 carrying an entity with no usable name is drift, not absence — and the two are
    // indistinguishable downstream, so the adapter is where it has to be said.
    const { port } = searcher([
      { match: `/${kind}/${mbid}`, json: { id: 'not-a-uuid', title: null, name: null } },
    ]);
    const watched = watchedScope();

    expect(await unwrap(port.lookup(asMbid(mbid), watched.scope))).toEqual({ kind: 'notFound' });
    expect(watched.warnings.join('')).toContain(said);
  });

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
  it('reads an artist the catalog does not know as no work at all', async () => {
    const { port } = searcher([]);

    expect(await unwrap(port.discography(asMbid(ARTIST_ID), testScope()))).toEqual([]);
  });

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
  it('reads a release group the catalog does not know as no editions to choose from', async () => {
    const { port } = searcher([]);

    expect(await unwrap(port.editions(asMbid(RG_ID), testScope()))).toEqual({
      groups: [],
      bestMatch: { kind: 'selectionRequired' },
    });
  });

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

    expect(listing.groups[0]?.representative.trackCount).toBe(11);
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
