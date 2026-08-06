import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

/**
 * A recorded contract fixture: one real request/response interaction captured from a live external
 * service, sanitized and committed. It is the frozen ground truth both tiers share — tier 1 replays
 * it against the real adapter over HTTP; the drift tier re-validates the live service against the
 * same schemas the fixture was checked with. `provenance` records where and when it came from so a
 * stale capture is visible; fixtures are never hand-authored (change: external-api-contract-tests).
 */
export interface ContractFixture {
  readonly provenance: {
    readonly source: string;
    readonly capturedAt: string; // ISO date
    readonly serviceVersion?: string;
    readonly note?: string;
  };
  readonly request: {
    readonly method: 'GET' | 'POST' | 'DELETE';
    readonly path: string;
    readonly query?: Record<string, string>;
  };
  readonly response: {
    readonly status: number;
    /**
     * Absent for the responses that carry no body at all — a 204 cancel ack, a 201 enqueue ack, the
     * 404 that signals "this user has no transfers".
     */
    readonly body?: unknown;
  };
}

export const CONTRACT_FIXTURE_ROOT = new URL('../fixtures/', import.meta.url).pathname;

/**
 * Load every `*.json` fixture under `fixtures/<service>/`, paired with its name — which is the path
 * relative to the service directory, so a fixture recorded by a named scenario is
 * `queued/transfers-poll.json` rather than a filename that has to encode its scenario. Nesting is what lets several scenarios
 * record the *same* endpoint (each transfer state is another poll of one URL) without colliding, and
 * lets a replay test serve one scenario in isolation.
 */
function readFixture(path: string, name: string): ContractFixture {
  const raw = readFileSync(path, 'utf8');
  try {
    return JSON.parse(raw) as ContractFixture;
  } catch (cause) {
    // A bare SyntaxError names neither the file nor the directory it was found in, which the
    // recursive walk makes harder to locate rather than easier.
    throw new Error(`fixture ${name} is not valid JSON: ${String(cause)}`);
  }
}

export function loadFixtures(service: string): { name: string; fixture: ContractFixture }[] {
  const root = join(CONTRACT_FIXTURE_ROOT, service);

  const walk = (dir: string, prefix: string): { name: string; fixture: ContractFixture }[] =>
    readdirSync(dir, { withFileTypes: true })
      .sort((a, b) => a.name.localeCompare(b.name))
      .flatMap((entry) => {
        const name = `${prefix}${entry.name}`;
        if (entry.isDirectory()) return walk(join(dir, entry.name), `${name}/`);
        if (!entry.name.endsWith('.json')) return [];
        return [{ name, fixture: readFixture(join(dir, entry.name), name) }];
      });

  return walk(root, '');
}

/**
 * The fixtures of one recorded scenario — `loadFixtures` filtered to a scenario directory, with the
 * directory stripped from each name. Replay tests take a scenario at a time so the fixture server
 * serves exactly one recorded reality: a queued poll and a cancelled poll are the same URL, and
 * only isolation keeps them from overwriting each other.
 */
export function loadScenario(
  service: string,
  scenario: string,
): { name: string; fixture: ContractFixture }[] {
  const prefix = `${scenario}/`;
  const found = loadFixtures(service)
    .filter((f) => f.name.startsWith(prefix))
    .map((f) => ({ ...f, name: f.name.slice(prefix.length) }));
  // A scenario with no fixtures is never legitimate — it means a typo. Returning nothing would
  // serve a fixture server with zero routes, and every request would 404 far from the cause.
  if (found.length === 0)
    throw new Error(`no fixtures recorded for scenario ${service}/${scenario}`);
  return found;
}
