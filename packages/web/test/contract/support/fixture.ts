import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

/**
 * A recorded contract fixture: one real request/response interaction captured from live plex.tv,
 * sanitized and committed (external-api-contracts). The frozen ground truth the tier replays
 * against the real adapter over HTTP. `provenance` records where and when it came from; fixtures
 * are recorded by `record/plextv.ts`, never hand-authored — and the recorder projects every body
 * to consumed fields and scrubs tokens/account data before anything is written.
 */
export interface ContractFixture {
  readonly provenance: {
    readonly source: string;
    readonly capturedAt: string; // ISO date
    readonly note?: string;
  };
  readonly request: {
    readonly method: 'GET' | 'POST';
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
