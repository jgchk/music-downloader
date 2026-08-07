import { describe, expect, it } from 'vitest';
import type { HttpClient, HttpRequest, HttpResponse } from '../support/http.js';
import { SlskdClient } from './client.js';

function recordingClient(response: HttpResponse): { http: HttpClient; sent: HttpRequest[] } {
  const sent: HttpRequest[] = [];
  return {
    sent,
    http: {
      send: (request) => {
        sent.push(request);
        return Promise.resolve(response);
      },
    },
  };
}

describe('SlskdClient', () => {
  it('performs an authorized GET against the configured base URL and parses JSON', async () => {
    const { http, sent } = recordingClient({ status: 200, body: JSON.stringify({ ok: true }) });
    const client = new SlskdClient(http, { baseUrl: 'http://slskd:1234', apiKey: 'secret' });

    const body = await client.get('/api/v0/searches/s1');

    expect(body).toEqual({ ok: true });
    expect(sent[0]).toMatchObject({
      method: 'GET',
      url: 'http://slskd:1234/api/v0/searches/s1',
      // slskd negotiates on these two: it serves JSON only when asked for it, and reads a request
      // body only when it is declared as JSON. Every request the client makes speaks JSON.
      headers: {
        'X-API-Key': 'secret',
        'Content-Type': 'application/json',
        Accept: 'application/json',
      },
    });
    expect(sent[0]?.body).toBeUndefined();
  });

  it('serializes a POST body and defaults the base URL and key', async () => {
    const { http, sent } = recordingClient({ status: 201, body: JSON.stringify({ id: 's1' }) });
    const client = new SlskdClient(http);

    const body = await client.post('/api/v0/searches', { searchText: 'x' });

    expect(body).toEqual({ id: 's1' });
    expect(sent[0]).toMatchObject({
      method: 'POST',
      url: 'http://localhost:5030/api/v0/searches',
      body: JSON.stringify({ searchText: 'x' }),
      headers: { 'X-API-Key': '' },
    });
  });

  it('issues a DELETE at the requested path and returns undefined for an empty response', async () => {
    const { http, sent } = recordingClient({ status: 204, body: '' });
    const client = new SlskdClient(http);

    expect(await client.del('/api/v0/transfers/downloads/u1/t1')).toBeUndefined();
    expect(sent).toEqual([
      expect.objectContaining({
        method: 'DELETE',
        url: 'http://localhost:5030/api/v0/transfers/downloads/u1/t1',
      }),
    ]);
  });

  it('reads the events log with an authorized, paginated GET', async () => {
    const { http, sent } = recordingClient({ status: 200, body: JSON.stringify([]) });
    const client = new SlskdClient(http, { baseUrl: 'http://slskd:1234', apiKey: 'secret' });

    const body = await client.events(50, 100);

    expect(body).toEqual([]);
    expect(sent[0]).toMatchObject({
      method: 'GET',
      url: 'http://slskd:1234/api/v0/events?offset=50&limit=100',
      headers: { 'X-API-Key': 'secret' },
    });
  });

  it('reads the options with an authorized GET', async () => {
    const { http, sent } = recordingClient({
      status: 200,
      body: JSON.stringify({ directories: { downloads: '/app/downloads' } }),
    });
    const client = new SlskdClient(http, { apiKey: 'secret' });

    const body = await client.options();

    expect(body).toEqual({ directories: { downloads: '/app/downloads' } });
    expect(sent[0]).toMatchObject({ method: 'GET', url: 'http://localhost:5030/api/v0/options' });
  });

  /**
   * Every read path answers the same question — is this a result, or a fault the adapter must map
   * to an `InfraError`? — and answers it with the 2xx window. The edges are asserted because they
   * are the ones a body alone cannot settle: a 1xx is not slskd's final answer, and a 300 is a
   * redirect this client does not follow, so neither carries a result to hand inward.
   */
  describe.each([
    { path: 'get', invoke: (client: SlskdClient) => client.get('/api/v0/searches/s1') },
    { path: 'getOr', invoke: (client: SlskdClient) => client.getOr('/api/v0/searches/s1', {}) },
    {
      path: 'delIfPresent',
      invoke: (client: SlskdClient) => client.delIfPresent('/api/v0/searches/s1'),
    },
  ])('$path, outside the 2xx success window', ({ invoke }) => {
    it.each([100, 199, 300, 301, 500])('faults on a %i response', async (status) => {
      const { http } = recordingClient({ status, body: JSON.stringify({ ok: true }) });

      await expect(invoke(new SlskdClient(http))).rejects.toThrow(`slskd responded ${status}`);
    });

    it.each([200, 204])('accepts a %i response as a result', async (status) => {
      const { http } = recordingClient({ status, body: '' });

      await expect(invoke(new SlskdClient(http))).resolves.toBeUndefined();
    });
  });

  it('keeps the peer username out of every thrown message (dead-letter-bound strings)', async () => {
    // These messages land in parked-effect lastError fields and dead-letter payloads, where the
    // pino redaction paths cannot follow (redaction covers structured fields, not string
    // interpolation). The downloads path embeds the URL-encoded peer username, so the thrown
    // message must carry the route shape, never the raw path.
    const { http } = recordingClient({ status: 500, body: 'boom' });
    const client = new SlskdClient(http);
    const path = '/api/v0/transfers/downloads/peer%40name.42';

    // The whole peer segment is replaced, not merely dented: the messages are asserted verbatim,
    // because a redaction that leaves any part of the name behind still leaks it.
    for (const [attempt, expected] of [
      [client.get(path), 'slskd responded 500 for GET /api/v0/transfers/downloads/<peer>'],
      [client.getOr(path, {}), 'slskd responded 500 for GET /api/v0/transfers/downloads/<peer>'],
      [
        client.delIfPresent(`${path}/t-1?remove=false`),
        'slskd responded 500 for DELETE /api/v0/transfers/downloads/<peer>/t-1?remove=false',
      ],
    ] as const) {
      let thrown: Error | undefined;
      try {
        await attempt;
      } catch (error) {
        thrown = error as Error;
      }
      expect(thrown, 'expected a non-2xx throw').toBeDefined();
      expect(thrown!.message).toBe(expected);
    }
  });

  describe('getOr', () => {
    it('returns the fallback for a 404 (an absent collection is a state, not a fault)', async () => {
      const { http } = recordingClient({ status: 404, body: '' });
      const client = new SlskdClient(http);

      await expect(client.getOr('/api/v0/transfers/downloads/u', {})).resolves.toEqual({});
    });

    it('parses a 2xx body like a plain GET', async () => {
      const { http } = recordingClient({ status: 200, body: JSON.stringify({ directories: [] }) });
      const client = new SlskdClient(http);

      await expect(client.getOr('/api/v0/transfers/downloads/u', {})).resolves.toEqual({
        directories: [],
      });
    });

    it('returns undefined for an empty 2xx body, like a plain GET', async () => {
      const { http } = recordingClient({ status: 204, body: '' });
      const client = new SlskdClient(http);

      await expect(client.getOr('/api/v0/transfers/downloads/u', {})).resolves.toBeUndefined();
    });
  });

  describe('delIfPresent', () => {
    it('resolves on a successful delete', async () => {
      const { http, sent } = recordingClient({ status: 204, body: '' });
      const client = new SlskdClient(http);

      await expect(client.delIfPresent('/api/v0/searches/s1')).resolves.toBeUndefined();
      expect(sent[0]).toMatchObject({ method: 'DELETE' });
    });

    it('treats a 404 (already absent) as success', async () => {
      const { http } = recordingClient({ status: 404, body: 'not found' });
      const client = new SlskdClient(http);

      await expect(client.delIfPresent('/api/v0/searches/gone')).resolves.toBeUndefined();
    });
  });
});
