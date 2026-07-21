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
    let body = '';
    req.on('data', (chunk) => {
      body += chunk;
    });
    req.on('end', () => {
      requests.push({
        method: req.method ?? '',
        path: url.pathname,
        query: Object.fromEntries(url.searchParams),
        headers: req.headers as Record<string, string | undefined>,
        body,
      });
      const fixture = routes.get(`${req.method} ${url.pathname}`);
      if (fixture !== undefined) {
        const payload =
          fixture.response.body === undefined ? '' : JSON.stringify(fixture.response.body);
        res.writeHead(fixture.response.status, { 'Content-Type': 'application/json' });
        res.end(payload);
        return;
      }
      if (req.method === 'DELETE' && url.pathname.includes('/transfers/downloads/')) {
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
