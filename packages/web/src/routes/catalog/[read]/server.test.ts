import { describe, expect, it, vi } from 'vitest';
import { GET } from './+server.js';
import type { DownloaderFacade } from '@music/downloader';

const MBID = '19847822-1430-3380-9cf1-bc45545b34ac';
const STORY = 'story-1';

const RESULTS = {
  leading: 'release-group' as const,
  releaseGroups: [
    { mbid: MBID, title: 'Graceland', artistCredit: 'Paul Simon', secondaryTypes: [] },
  ],
  artists: [],
  recordings: [],
};

function facade(overrides: Partial<Record<keyof DownloaderFacade, unknown>> = {}) {
  return {
    searchCatalog: vi.fn(() => Promise.resolve({ ok: true, value: RESULTS })),
    lookupCatalog: vi.fn(() => Promise.resolve({ ok: true, value: { kind: 'not-found' } })),
    browseArtist: vi.fn(() => Promise.resolve({ ok: true, value: { releaseGroups: [] } })),
    listEditions: vi.fn(() =>
      Promise.resolve({
        ok: true,
        value: { groups: [], bestMatch: { kind: 'selection-required' } },
      }),
    ),
    getTracklist: vi.fn(() => Promise.resolve({ ok: true, value: { tracks: [] } })),
    ...overrides,
  };
}

function event(read: string, query: string, downloader: unknown) {
  return {
    params: { read },
    url: new URL(`https://app.test/catalog/${read}?${query}`),
    locals: { facades: { downloader }, correlationId: STORY, logger: { warn: vi.fn() } },
  } as never;
}

describe('GET /catalog/[read]', () => {
  it('answers a search with the catalog’s results', async () => {
    const downloader = facade();

    const response = await GET(event('search', 'q=graceland', downloader));

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual(RESULTS);
    expect(downloader.searchCatalog).toHaveBeenCalledWith({ query: 'graceland' }, STORY);
  });

  it('reads a blank query as a blank search rather than refusing it', async () => {
    const downloader = facade();

    await GET(event('search', '', downloader));

    expect(downloader.searchCatalog).toHaveBeenCalledWith({ query: '' }, STORY);
  });

  it.each([
    ['lookup', 'lookupCatalog'],
    ['discography', 'browseArtist'],
    ['editions', 'listEditions'],
    ['tracklist', 'getTracklist'],
  ])('routes %s to the facade read that answers it', async (read, verb) => {
    const downloader = facade();

    const response = await GET(event(read, `mbid=${MBID}`, downloader));

    expect(response.status).toBe(200);
    expect(downloader[verb as 'lookupCatalog']).toHaveBeenCalledWith({ mbid: MBID }, STORY);
  });

  it('passes a refusal through with its status and an actionable message', async () => {
    const downloader = facade({
      searchCatalog: vi.fn(() =>
        Promise.resolve({
          ok: false,
          error: { kind: 'ValidationFailed', message: 'query required' },
        }),
      ),
    });

    const response = await GET(event('search', 'q=', downloader));

    expect(response.status).toBe(400);
    expect(await response.json()).toEqual({ message: 'Invalid input: query required' });
  });

  it('reports an unreachable catalog as a server-side fault, not as empty results', async () => {
    const downloader = facade({
      searchCatalog: vi.fn(() =>
        Promise.resolve({
          ok: false,
          error: {
            kind: 'InfraError',
            operation: 'musicbrainz.catalog.search',
            message: 'down',
            reason: 'unreachable',
          },
        }),
      ),
    });

    const response = await GET(event('search', 'q=graceland', downloader));

    // 502, not 500: the catalog could not be REACHED, which may pass. The page's copy turns on
    // this, so collapsing the two here would put "that is a bug" in front of an outage.
    expect(response.status).toBe(502);
    expect(await response.json()).toEqual({
      message: 'Something went wrong. Try again.',
    });
  });

  it('writes down a fault the answer cannot carry, so an outage is not just a 500', async () => {
    // Below the route the cause is gone: the zod issue that says which field drifted, the fetch
    // error that says the catalog is unreachable. Unlogged, an operator has the request and no
    // record that anything failed.
    const warn = vi.fn();
    const error = {
      kind: 'InfraError',
      operation: 'musicbrainz.catalog.search',
      message: 'down',
    };
    const downloader = facade({
      searchCatalog: vi.fn(() => Promise.resolve({ ok: false, error })),
    });
    const request = {
      params: { read: 'search' },
      url: new URL('https://app.test/catalog/search?q=graceland'),
      locals: { facades: { downloader }, correlationId: STORY, logger: { warn } },
    } as never;

    await GET(request);

    expect(warn).toHaveBeenCalledWith({ read: 'search', error }, 'catalog read failed');
  });

  it('says nothing to the log about a refusal, which is the caller’s to fix', async () => {
    // A widened guard — `status >= 400` — would turn every malformed request into an operator
    // alert, so the refusing case has to be the one asserted, not a successful read.
    const warn = vi.fn();
    const downloader = facade({
      lookupCatalog: vi.fn(() =>
        Promise.resolve({
          ok: false as const,
          error: { kind: 'ValidationFailed' as const, message: 'not a MusicBrainz identifier' },
        }),
      ),
    });
    const request = {
      params: { read: 'lookup' },
      url: new URL('https://app.test/catalog/lookup?mbid=not-an-mbid'),
      locals: { facades: { downloader }, correlationId: STORY, logger: { warn } },
    } as never;

    const response = await GET(request);

    expect(response.status).toBe(400);
    expect(warn).not.toHaveBeenCalled();
  });

  it('has nothing to say about a read it does not offer', async () => {
    const response = await GET(event('everything', 'q=x', facade()));

    expect(response.status).toBe(404);
  });
});
