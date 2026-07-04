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

  it('throws on a non-2xx status so the adapter can map it to an InfraError', async () => {
    const { http } = recordingClient({ status: 500, body: 'boom' });
    const client = new SlskdClient(http);

    await expect(client.get('/api/v0/searches/s1')).rejects.toThrow('slskd responded 500');
  });
});
