import { describe, expect, it, vi } from 'vitest';
import { MALFORMED, UNREACHABLE, UNREADABLE, httpCatalog } from './client.js';

const MBID = '19847822-1430-3380-9cf1-bc45545b34ac';

/** A well-shaped answer for each read, so the client's own shape check is not what is under test. */
const BODIES: Record<string, unknown> = {
  search: { leading: 'release-group', releaseGroups: [], artists: [], recordings: [] },
  lookup: { kind: 'not-found' },
  discography: { releaseGroups: [] },
  editions: { groups: [], bestMatch: { kind: 'selection-required' } },
  tracklist: { tracks: [] },
};

function fetchStub(response: Response | Error): typeof fetch & ReturnType<typeof vi.fn> {
  const stub = vi.fn();
  if (response instanceof Error) stub.mockRejectedValue(response);
  else stub.mockResolvedValue(response);
  return stub as never;
}

describe('httpCatalog', () => {
  it('asks the catalog what matches a query', async () => {
    const stub = fetchStub(Response.json(BODIES.search));

    const answer = await httpCatalog(stub).search('paul simon graceland');

    expect(answer).toEqual({ ok: true, value: BODIES.search });
    expect(stub).toHaveBeenCalledWith('/catalog/search?q=paul+simon+graceland', expect.anything());
  });

  it.each([
    ['lookup', (client: ReturnType<typeof httpCatalog>) => client.lookup(MBID)],
    ['discography', (client: ReturnType<typeof httpCatalog>) => client.discography(MBID)],
    ['editions', (client: ReturnType<typeof httpCatalog>) => client.editions(MBID)],
    ['tracklist', (client: ReturnType<typeof httpCatalog>) => client.tracklist(MBID)],
  ])('asks the %s read for one identifier', async (read, call) => {
    const stub = fetchStub(Response.json(BODIES[read]));

    const answer = await call(httpCatalog(stub));

    expect(stub).toHaveBeenCalledWith(`/catalog/${read}?mbid=${MBID}`, expect.anything());
    expect(answer).toEqual({ ok: true, value: BODIES[read] });
  });

  it('refuses an answer of the right status but the wrong shape', async () => {
    // A stale deploy, a proxy, or another route matching: JSON that parses but is not this answer.
    // Told apart from an unreadable body, because "sign in again" cannot fix a shape disagreement.
    vi.spyOn(console, 'error').mockImplementation(() => {});
    const stub = fetchStub(Response.json({ leading: 'nonsense' }));

    const answer = await httpCatalog(stub).search('graceland');

    expect(answer).toEqual({ ok: false, message: MALFORMED });
    expect(console.error).toHaveBeenCalled();
  });

  it('reports a refusal as a message a person can act on', async () => {
    const stub = fetchStub(
      Response.json({ message: 'Invalid input: query required' }, { status: 400 }),
    );

    const answer = await httpCatalog(stub).search('x');

    expect(answer).toEqual({ ok: false, message: 'Invalid input: query required' });
  });

  it('reports an unreachable server without inventing a message for it', async () => {
    const stub = fetchStub(new Error('offline'));

    const answer = await httpCatalog(stub).search('graceland');

    expect(answer).toEqual({ ok: false, message: UNREACHABLE });
  });

  it('refuses to read a signed-out redirect as a successful search', async () => {
    // The gate sends an expired session to the sign-in page; `fetch` follows the redirect, so the
    // page receives 200 HTML. Reporting that as success would show "nothing matched" to someone
    // who is simply signed out — and then break on a body that has no results in it.
    const stub = fetchStub(
      new Response('<!doctype html><title>Sign in</title>', {
        status: 200,
        headers: { 'Content-Type': 'text/html' },
      }),
    );

    const answer = await httpCatalog(stub).search('graceland');

    expect(answer).toEqual({ ok: false, message: UNREADABLE });
  });

  it('falls back to a message a person can act on when the server sent none', async () => {
    const stub = fetchStub(new Response('gateway', { status: 502 }));

    const answer = await httpCatalog(stub).search('graceland');

    expect(answer).toEqual({ ok: false, message: UNREACHABLE });
  });

  it('refuses a refusal whose message is not words a person could read', async () => {
    // The message is rendered verbatim; a proxy answering with a shape of its own would otherwise
    // reach the page as "[object Object]".
    const stub = fetchStub(Response.json({ message: { code: 42 } }, { status: 400 }));

    const answer = await httpCatalog(stub).search('graceland');

    expect(answer).toEqual({ ok: false, message: UNREACHABLE });
  });

  it('gives up on a server that accepts the request and never answers', async () => {
    // A silent connection is the least actionable state there is: the search would spin forever
    // and a person cannot tell it from a slow catalog. The deadline is a seam so this test proves
    // the behaviour in milliseconds rather than waiting out the production one.
    const stub = vi.fn(
      (_path: string, init?: RequestInit) =>
        new Promise<Response>((_resolve, reject) => {
          init?.signal?.addEventListener('abort', () => reject(new Error('timed out')));
        }),
    ) as never;

    const answer = await httpCatalog(stub, { timeoutMs: 5 }).search('graceland');

    expect(answer).toEqual({ ok: false, message: UNREACHABLE });
  });

  it('abandons the request when the caller abandons the search', async () => {
    // The page abandons a search the moment a newer keystroke starts one; the request must go
    // with it rather than run to completion against a page that has moved on.
    const stub = vi.fn(
      (_path: string, init?: RequestInit) =>
        new Promise<Response>((_resolve, reject) => {
          init?.signal?.addEventListener('abort', () => reject(new Error('abandoned')));
        }),
    ) as never;
    const controller = new AbortController();

    const answer = httpCatalog(stub).search('graceland', controller.signal);
    controller.abort();

    expect(await answer).toEqual({ ok: false, message: UNREACHABLE });
  });
});
