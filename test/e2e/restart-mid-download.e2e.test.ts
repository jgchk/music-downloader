import { execSync } from 'node:child_process';
import { beforeAll, describe, expect, it } from 'vitest';
import {
  BASE_URL,
  MBID,
  pollUntilTerminal,
  readStatus,
  seedStagedFixture,
  submitAcquisition,
  waitForOk,
} from './helpers.js';

/**
 * Restart resumption mid-download (reactor-durability D3): the process dies while a transfer is
 * in flight at the source — the poller that owned its stall/queue budgets dies with it — and a
 * restart must drive the download to an outcome rather than orphaning it in `Downloading`
 * forever (the pre-change behavior: "not downloaded a second time" was satisfied by never
 * driving it again).
 *
 * The window is forced through the slskd stub's scenario state: a `Hold` state keeps every poll
 * reporting the transfer in progress, so the kill provably lands mid-download. While the process
 * is down the transfer completes at the source (state flips to `Completed`); after the restart
 * the re-drive pass re-derives the pending Download effect, the adapter reconciles against the
 * source's live transfer — re-attaching instead of enqueueing a second time — and the
 * acquisition runs to Fulfilled. The WireMock request journal proves the single enqueue.
 */

const APP_CONTAINER = process.env['E2E_APP_CONTAINER'] ?? 'music-e2e-app';
const SLSKD_ADMIN = process.env['E2E_SLSKD_ADMIN_URL'] ?? 'http://localhost:8082/__admin';
const DOWNLOADS_PATH = '/api/v0/transfers/downloads/peer1';

function docker(args: string): void {
  execSync(`docker ${args}`, { stdio: 'inherit', timeout: 60_000 });
}

async function admin(method: string, path: string, body?: unknown): Promise<unknown> {
  const res = await fetch(`${SLSKD_ADMIN}${path}`, {
    method,
    headers: { 'Content-Type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  if (!res.ok) throw new Error(`${method} ${path} returned ${res.status}`);
  return res.headers.get('content-type')?.includes('json') ? res.json() : undefined;
}

async function enqueueCount(): Promise<number> {
  const body = (await admin('POST', '/requests/count', {
    method: 'POST',
    urlPath: DOWNLOADS_PATH,
  })) as { count: number };
  return body.count;
}

/** The same transfer the static mappings describe, pinned in progress while the scenario Holds. */
const HOLD_MAPPING = {
  scenarioName: 'transfer',
  requiredScenarioState: 'Hold',
  request: {
    method: 'GET',
    urlPath: DOWNLOADS_PATH,
    headers: { 'X-API-Key': { equalTo: 'test-key' } },
  },
  response: {
    status: 200,
    headers: { 'Content-Type': 'application/json' },
    jsonBody: {
      username: 'peer1',
      directories: [
        {
          directory: '@@music\\Test Artist\\Test Album',
          fileCount: 1,
          files: [
            {
              id: 'transfer-1',
              filename: '@@music\\Test Artist\\Test Album\\01 Track One.flac',
              state: 'InProgress, Transferring',
              size: 1234567,
              bytesTransferred: 617283,
            },
          ],
        },
      ],
    },
  },
};

async function pollUntil(check: () => Promise<boolean>, what: string): Promise<void> {
  const deadline = Date.now() + 60_000;
  for (;;) {
    if (await check()) return;
    if (Date.now() >= deadline) throw new Error(`timed out waiting for ${what}`);
    await new Promise((resolve) => setTimeout(resolve, 500));
  }
}

describe('restart resumption mid-download (reactor-durability)', () => {
  beforeAll(async () => {
    seedStagedFixture();
    await admin('POST', '/mappings', HOLD_MAPPING);
    await admin('PUT', '/scenarios/transfer/state', { state: 'Hold' });
    await waitForOk(BASE_URL);
  });

  it('drives a mid-flight transfer to its outcome across a restart, with exactly one enqueue', async () => {
    const acquisitionId = await submitAcquisition(MBID);

    // The download is provably mid-flight: enqueued at the source, polling sees it in progress.
    await pollUntil(async () => (await enqueueCount()) === 1, 'the enqueue to reach the source');
    await pollUntil(
      async () => (await readStatus(acquisitionId)) === 'Downloading',
      'the acquisition to be downloading',
    );

    // Kill the process mid-download. While it is down, the transfer completes at the source.
    docker(`stop -t 5 ${APP_CONTAINER}`);
    await admin('PUT', '/scenarios/transfer/state', { state: 'Completed' });
    docker(`start ${APP_CONTAINER}`);
    await waitForOk(BASE_URL);

    // The startup re-drive re-derives the Download effect and the adapter re-attaches to the
    // source's transfer: the acquisition reaches its terminal outcome instead of orphaning.
    expect(await pollUntilTerminal(acquisitionId, 180_000)).toBe('Fulfilled');

    // The candidate was never downloaded a second time: one enqueue across both process lives.
    expect(await enqueueCount()).toBe(1);
  });
});
