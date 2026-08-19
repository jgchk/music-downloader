import { describe, expect, it, vi } from 'vitest';
import { httpCatalog } from './client.js';

const MBID = '19847822-1430-3380-9cf1-bc45545b34ac';

function fetchStub(response: Response | Error): typeof fetch & ReturnType<typeof vi.fn> {
  const stub = vi.fn();
  if (response instanceof Error) stub.mockRejectedValue(response);
  else stub.mockResolvedValue(response);
  return stub as never;
}

describe('httpCatalog', () => {
  it('asks the catalog what matches a query', async () => {
    const stub = fetchStub(Response.json({ leading: 'release-group' }));

    const answer = await httpCatalog(stub).search('paul simon graceland');

    expect(answer).toEqual({ ok: true, value: { leading: 'release-group' } });
    expect(stub).toHaveBeenCalledWith('/catalog/search?q=paul+simon+graceland', expect.anything());
  });

  it.each([
    ['lookup', (client: ReturnType<typeof httpCatalog>) => client.lookup(MBID)],
    ['discography', (client: ReturnType<typeof httpCatalog>) => client.discography(MBID)],
    ['editions', (client: ReturnType<typeof httpCatalog>) => client.editions(MBID)],
    ['tracklist', (client: ReturnType<typeof httpCatalog>) => client.tracklist(MBID)],
  ])('asks the %s read for one identifier', async (read, call) => {
    const stub = fetchStub(Response.json({}));

    await call(httpCatalog(stub));

    expect(stub).toHaveBeenCalledWith(`/catalog/${read}?mbid=${MBID}`, expect.anything());
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

    expect(answer.ok).toBe(false);
    if (answer.ok) return;
    expect(answer.message.length).toBeGreaterThan(0);
  });

  it('reports a refusal that carries no message at all', async () => {
    const stub = fetchStub(new Response('gateway', { status: 502 }));

    const answer = await httpCatalog(stub).search('graceland');

    expect(answer.ok).toBe(false);
  });

  it('abandons a search when asked to, rather than racing the next one', async () => {
    const stub = fetchStub(Response.json({}));
    const controller = new AbortController();

    await httpCatalog(stub).search('graceland', controller.signal);

    expect(stub.mock.calls[0]?.[1]).toMatchObject({ signal: controller.signal });
  });
});
