import { createServer } from 'node:http';
import type { Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createFetchHttpClient, fetchHttpClient } from './http.js';

// Drive the real fetch wrapper against a throwaway localhost server — deterministic, no network.
let server: Server;
let base: string;

beforeAll(async () => {
  server = createServer((request, response) => {
    const { method, url } = request;
    // Node always fills both in for a server-side request; they are optional only because
    // `IncomingMessage` doubles as a client response type. Refuse loudly rather than echo the word
    // "undefined" into the body, which would read as a wire-shape bug in the client under test.
    if (method === undefined || url === undefined) {
      response.writeHead(500);
      response.end('malformed request line');
      return;
    }
    if (url === '/hang') return; // never respond — the timeout must fire
    let body = '';
    request.on('data', (chunk: Buffer) => (body += chunk.toString()));
    request.on('end', () => {
      response.writeHead(200, { 'content-type': 'text/plain' });
      response.end(`${method} ${url} ${body}`);
    });
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});

afterAll(() => new Promise<void>((resolve) => server.close(() => resolve())));

describe('fetchHttpClient', () => {
  it('performs a GET by default', async () => {
    const response = await fetchHttpClient.send({ url: `${base}/get` });

    expect(response.status).toBe(200);
    expect(response.body).toBe('GET /get ');
  });

  it('sends a POST with a body', async () => {
    const response = await fetchHttpClient.send({
      method: 'POST',
      url: `${base}/post`,
      headers: { 'content-type': 'text/plain' },
      body: 'payload',
    });

    expect(response.body).toBe('POST /post payload');
  });
});

describe('createFetchHttpClient — timeout', () => {
  it('fails a hung request instead of waiting forever (a frozen fetch must not wedge the caller)', async () => {
    const client = createFetchHttpClient(100);

    await expect(client.send({ url: `${base}/hang` })).rejects.toThrow(/timeout|abort/i);
  });
});
