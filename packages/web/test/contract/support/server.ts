import { createServer } from 'node:http';
import type { Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import type { ContractFixture } from './fixture.js';

/**
 * A throwaway HTTP server that replays recorded plex.tv fixtures (the downloader tier's pattern).
 * The real `PlexTvAccess` adapter, with its real `fetch`, is pointed at this server's
 * ephemeral port, so the tier exercises genuine wire behaviour — URL construction, identity
 * headers, token headers, status handling — against frozen ground truth, offline. Every incoming
 * request is recorded so tests can assert what the adapter actually sent.
 */

export interface RecordedRequest {
  readonly method: string;
  readonly path: string;
  readonly query: Record<string, string>;
  readonly headers: Record<string, string | undefined>;
}

export interface FixtureServer {
  readonly baseUrl: string;
  readonly requests: readonly RecordedRequest[];
  readonly close: () => Promise<void>;
}

/** Serve the given fixtures, routing by `METHOD pathname`; an unmatched request 404s. */
export async function startFixtureServer(
  fixtures: readonly { readonly fixture: ContractFixture }[],
): Promise<FixtureServer> {
  const requests: RecordedRequest[] = [];
  const routes = new Map<string, ContractFixture>();
  for (const { fixture } of fixtures) {
    routes.set(`${fixture.request.method} ${fixture.request.path}`, fixture);
  }

  const server: Server = createServer((request, response) => {
    const url = new URL(request.url ?? '', 'http://localhost');
    // Node always sets the method on a server-side request (`IncomingMessage` types it as optional
    // only because it doubles as a client response). Resolve it once, so the recorded request and
    // the route lookup can never disagree — and an absent method 404s rather than looking up a key
    // that begins with the word "undefined".
    const method = request.method ?? '';
    requests.push({
      method,
      path: url.pathname,
      query: Object.fromEntries(url.searchParams),
      headers: request.headers as Record<string, string | undefined>,
    });
    const fixture = routes.get(`${method} ${url.pathname}`);
    if (fixture === undefined) {
      response.writeHead(404);
      response.end();
      return;
    }
    const payload =
      fixture.response.body === undefined ? '' : JSON.stringify(fixture.response.body);
    response.writeHead(fixture.response.status, { 'Content-Type': 'application/json' });
    response.end(payload);
  });

  // Reject on listen failure so the tier fails with the real error, not a vitest timeout.
  await new Promise<void>((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', resolve);
  });
  const { port } = server.address() as AddressInfo;

  return {
    baseUrl: `http://127.0.0.1:${port}`,
    requests,
    close: () =>
      new Promise<void>((resolve, reject) => {
        server.close((error) => (error ? reject(error) : resolve()));
      }),
  };
}
