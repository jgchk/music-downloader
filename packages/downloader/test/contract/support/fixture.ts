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
    readonly body: unknown;
  };
}

export const CONTRACT_FIXTURE_ROOT = new URL('../fixtures/', import.meta.url).pathname;

/** Load every `*.json` fixture under `fixtures/<service>/`, paired with its filename. */
export function loadFixtures(service: string): { name: string; fixture: ContractFixture }[] {
  const dir = join(CONTRACT_FIXTURE_ROOT, service);
  return readdirSync(dir)
    .filter((name) => name.endsWith('.json'))
    .sort()
    .map((name) => ({
      name,
      fixture: JSON.parse(readFileSync(join(dir, name), 'utf8')) as ContractFixture,
    }));
}
