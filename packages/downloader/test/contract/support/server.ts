import { createServer } from 'node:http';
import type { Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import type { ContractFixture } from './fixture.js';

/**
 * A throwaway HTTP server that replays recorded contract fixtures (change:
 * external-api-contract-tests). The real adapter, with its real `fetch` client, is pointed at this
 * server's ephemeral port, so tier 1 exercises genuine wire behaviour — URL construction, headers,
 * status handling — against frozen ground truth, with no containers or network. Every incoming
 * request is recorded so tests can assert what the adapter actually sent.
 */

export interface RecordedRequest {
  readonly method: string;
  readonly path: string;
  readonly query: Record<string, string>;
  readonly headers: Record<string, string | undefined>;
  readonly body: string;
}

export interface FixtureServer {
  readonly baseUrl: string;
  readonly requests: readonly RecordedRequest[];
  readonly close: () => Promise<void>;
}

/**
 * Serve the given fixtures, routing by `METHOD pathname`. An unmatched request 404s — except a
 * `DELETE` under a transfers path, which returns slskd's documented `204 No Content` cancel
 * response so the download adapter's abandon path can run without a bespoke recorded fixture.
 */
export async function startFixtureServer(
  fixtures: readonly { readonly fixture: ContractFixture }[],
): Promise<FixtureServer> {
  const requests: RecordedRequest[] = [];
  const routes = new Map<string, ContractFixture>();
  for (const { fixture } of fixtures) {
    routes.set(`${fixture.request.method} ${fixture.request.path}`, fixture);
  }

  const server: Server = createServer((req, res) => {
    const url = new URL(req.url ?? '', 'http://localhost');
    // Node always sets the method on a server-side request (`IncomingMessage` types it as optional
    // only because it doubles as a client response). Resolve it once, so the recorded request and
    // the route lookup can never disagree — and an absent method routes to the 404 arm rather than
    // looking up a key that begins with the word "undefined".
    const method = req.method ?? '';
    let body = '';
    req.on('data', (chunk: Buffer) => {
      body += chunk.toString();
    });
    req.on('end', () => {
      requests.push({
        method,
        path: url.pathname,
        query: Object.fromEntries(url.searchParams),
        headers: req.headers as Record<string, string | undefined>,
        body,
      });
      const fixture = routes.get(`${method} ${url.pathname}`);
      if (fixture !== undefined) {
        const { body, status } = fixture.response;
        // A recorded body that is already a string is served verbatim as text. slskd answers a
        // refused enqueue with the bare exception message, not JSON — running it through
        // JSON.stringify would wrap it in quotes and hand the adapter a string the real service
        // never sends, which is a harness artifact posing as a recording.
        if (typeof body === 'string') {
          res.writeHead(status, { 'Content-Type': 'text/plain' });
          res.end(body);
          return;
        }
        res.writeHead(status, { 'Content-Type': 'application/json' });
        res.end(body === undefined ? '' : JSON.stringify(body));
        return;
      }
      // slskd's documented 204 for a cancel/remove. Kept as a fallback because teardown issues one
      // DELETE per transfer per phase and recording every combination would pin the adapter's
      // round count rather than its contract; the `?remove=` values it sends ARE asserted, from
      // `server.requests`, by the teardown replay test.
      if (method === 'DELETE' && url.pathname.includes('/transfers/downloads/')) {
        res.writeHead(204);
        res.end();
        return;
      }
      res.writeHead(404);
      res.end();
    });
  });

  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const { port } = server.address() as AddressInfo;

  return {
    baseUrl: `http://127.0.0.1:${port}`,
    requests,
    close: () =>
      new Promise<void>((resolve, reject) =>
        server.close((err) => (err ? reject(err) : resolve())),
      ),
  };
}
