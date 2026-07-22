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
      headers: { 'X-API-Key': 'secret' },
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

  it('returns undefined for an empty DELETE response', async () => {
    const { http } = recordingClient({ status: 204, body: '' });
    const client = new SlskdClient(http);

    expect(await client.del('/api/v0/transfers/downloads/u1/t1')).toBeUndefined();
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

  it('throws on a non-2xx status so the adapter can map it to an InfraError', async () => {
    const { http } = recordingClient({ status: 500, body: 'boom' });
    const client = new SlskdClient(http);

    await expect(client.get('/api/v0/searches/s1')).rejects.toThrow('slskd responded 500');
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

    it('still throws on other non-2xx statuses', async () => {
      const { http } = recordingClient({ status: 500, body: 'boom' });
      const client = new SlskdClient(http);

      await expect(client.getOr('/api/v0/transfers/downloads/u', {})).rejects.toThrowError(/500/);
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

    it('still throws on other non-2xx statuses', async () => {
      const { http } = recordingClient({ status: 500, body: 'boom' });
      const client = new SlskdClient(http);

      await expect(client.delIfPresent('/api/v0/searches/s1')).rejects.toThrow(
        'slskd responded 500',
      );
    });
  });
});
