import { describe, expect, it, vi } from 'vitest';
import { cachingHttpClient } from './caching-http.js';
import type { HttpClient, HttpResponse } from './http.js';

const URL_A = 'https://provider.test/thing/a';
const URL_B = 'https://provider.test/thing/b';

/** A client that answers with the given responses in order, counting what it was asked. */
function client(...answers: (HttpResponse | Error)[]): HttpClient & { calls: () => number } {
  const send = vi.fn((): Promise<HttpResponse> => {
    const next = answers.shift() ?? { status: 200, body: 'ok' };
    return next instanceof Error ? Promise.reject(next) : Promise.resolve(next);
  });
  return { send, calls: () => send.mock.calls.length };
}

/** A hand-wound clock, so freshness is decided by the test rather than by how fast it runs. */
function clock(start = 1000): { now: () => Date; advance: (ms: number) => void } {
  let current = start;
  return {
    now: () => new Date(current),
    advance: (ms: number) => {
      current += ms;
    },
  };
}

/** A read whose answer is held back until the test releases it. */
function held(): { readonly client: HttpClient; release: (response: HttpResponse) => void } {
  const { promise, resolve } = Promise.withResolvers<HttpResponse>();
  return { client: { send: () => promise }, release: resolve };
}

describe('cachingHttpClient', () => {
  it('answers a repeated read from what it already holds', async () => {
    const inner = client({ status: 200, body: 'first' });
    const cached = cachingHttpClient(inner, {}, clock());

    const first = await cached.send({ url: URL_A });
    const second = await cached.send({ url: URL_A });

    expect(second).toEqual(first);
    expect(inner.calls()).toBe(1);
  });

  it('asks again once the answer it holds is no longer fresh', async () => {
    const inner = client({ status: 200, body: 'first' }, { status: 200, body: 'second' });
    const time = clock();
    const cached = cachingHttpClient(inner, { ttlMs: 1000 }, time);

    await cached.send({ url: URL_A });
    time.advance(1001);
    const again = await cached.send({ url: URL_A });

    expect(again.body).toBe('second');
    expect(inner.calls()).toBe(2);
  });

  it('serves two callers of the same read with one request', async () => {
    // A person typing mints overlapping reads; the second caller wants the first one's answer,
    // not another round trip for it.
    const pending = held();
    const cached = cachingHttpClient(pending.client, {}, clock());

    const both = Promise.all([cached.send({ url: URL_A }), cached.send({ url: URL_A })]);
    pending.release({ status: 200, body: 'shared' });

    expect(await both).toEqual([
      { status: 200, body: 'shared' },
      { status: 200, body: 'shared' },
    ]);
  });

  it('remembers a provider saying it holds nothing — that is an answer too', async () => {
    const inner = client({ status: 404, body: '' });
    const cached = cachingHttpClient(inner, {}, clock());

    await cached.send({ url: URL_A });
    await cached.send({ url: URL_A });

    expect(inner.calls()).toBe(1);
  });

  it('never remembers a failure as though it were an answer', async () => {
    // A passing outage remembered for two minutes is a passing outage that lasts two minutes.
    const inner = client({ status: 503, body: 'down' }, { status: 200, body: 'back' });
    const cached = cachingHttpClient(inner, {}, clock());

    await cached.send({ url: URL_A });
    const second = await cached.send({ url: URL_A });

    expect(second.body).toBe('back');
    expect(inner.calls()).toBe(2);
  });

  it('lets a read that could not be made be tried again', async () => {
    const inner = client(new Error('connection reset'), { status: 200, body: 'back' });
    const cached = cachingHttpClient(inner, {}, clock());

    await expect(cached.send({ url: URL_A })).rejects.toThrow('connection reset');
    const second = await cached.send({ url: URL_A });

    expect(second.body).toBe('back');
  });

  it('forgets the oldest answers rather than remembering every URL ever asked for', async () => {
    const inner = client();
    const cached = cachingHttpClient(inner, { maxEntries: 1 }, clock());

    await cached.send({ url: URL_A });
    await cached.send({ url: URL_B });
    await cached.send({ url: URL_B });
    await cached.send({ url: URL_A });

    expect(inner.calls()).toBe(3);
  });

  it('keeps its own time when none is given, so answers still go stale in production', async () => {
    // Constructed the way composition does — no injected clock — and still answers from memory.
    const inner = client({ status: 200, body: 'first' });
    const cached = cachingHttpClient(inner);

    await cached.send({ url: URL_A });
    await cached.send({ url: URL_A });

    expect(inner.calls()).toBe(1);
  });

  it('passes a write straight through, remembering nothing about it', async () => {
    const inner = client({ status: 201, body: 'made' }, { status: 201, body: 'made again' });
    const cached = cachingHttpClient(inner, {}, clock());

    await cached.send({ method: 'POST', url: URL_A, body: 'x' });
    await cached.send({ method: 'POST', url: URL_A, body: 'x' });

    expect(inner.calls()).toBe(2);
  });
});
