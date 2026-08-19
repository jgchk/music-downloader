import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  BASE_URL,
  IMPORT_VOICE_PHRASE,
  MBID,
  pollForStatus,
  pollUntilTerminal,
  readStatus,
  seedStagedFixture,
  sessionCookieHeader,
  statusPhrase,
  submitAcquisition,
  waitForOk,
} from './helpers.js';

/**
 * Non-blocking download observation (nonblocking-download-observation): the 2026-08-02 incident,
 * black-box. One slow transfer used to hold the reactor's dispatch mutex for its whole duration —
 * freezing every other acquisition's resolution and search, and even the cancel of the download
 * itself (the abort serialized behind the dispatch it was aborting).
 *
 * The slskd stub's `transfer` scenario is pinned to `Hold`, so every poll reports the transfer
 * mid-flight — a healthy, slow download that never settles on its own. While it holds:
 *   1. a second acquisition must run its whole pre-download pipeline and reach Downloading
 *      (pre-change: it sat frozen at "Identifying the release"), and
 *   2. cancelling the held download must land promptly (pre-change: the abort could not even
 *      dispatch until the transfer settled).
 * Releasing the scenario afterwards lets the second acquisition run to its terminal outcome —
 * the freed pipeline, proven end to end.
 */

const SLSKD_ADMIN = process.env.E2E_SLSKD_ADMIN_URL ?? 'http://localhost:8082/__admin';
const DOWNLOADS_PATH = '/api/v0/transfers/downloads/peer1';

async function admin(method: string, path: string, body?: unknown): Promise<Response> {
  const res = await fetch(`${SLSKD_ADMIN}${path}`, {
    method,
    headers: { 'Content-Type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  if (!res.ok) throw new Error(`${method} ${path} returned ${res.status}`);
  return res;
}

/** The stub's request journal: DELETE cancels the app issued against the held transfer. */
async function cancelDeletesSeen(): Promise<number> {
  const res = await admin('GET', '/requests');
  const body = (await res.json()) as { requests: { request: { method: string; url: string } }[] };
  return body.requests
    .map((entry) => entry.request)
    .filter(
      (request) =>
        request.method === 'DELETE' && request.url.startsWith(`${DOWNLOADS_PATH}/transfer-1`),
    ).length;
}

async function pollUntil(isSatisfied: () => Promise<boolean>, what: string): Promise<void> {
  const deadline = Date.now() + 30_000;
  for (;;) {
    if (await isSatisfied()) return;
    if (Date.now() >= deadline) throw new Error(`timed out waiting for ${what}`);
    await new Promise((resolve) => setTimeout(resolve, 500));
  }
}

/** The held transfer: every poll reports it in progress while the scenario stays `Hold`. */
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
          directory: String.raw`@@music\Test Artist\Test Album`,
          fileCount: 1,
          files: [
            {
              id: 'transfer-1',
              filename: String.raw`@@music\Test Artist\Test Album\01 Track One.flac`,
              state: 'InProgress',
              size: 1_234_567,
              bytesTransferred: 617_283,
            },
          ],
        },
      ],
    },
  },
};

/** Cancel through the real form action, exactly as the detail page's cancel button posts it. */
async function cancelAcquisition(id: string): Promise<void> {
  const res = await fetch(`${BASE_URL}/acquisitions/${id}?/cancel`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/x-www-form-urlencoded',
      Origin: BASE_URL,
      Cookie: sessionCookieHeader(),
    },
    body: new URLSearchParams(),
    redirect: 'manual',
  });
  if (res.status !== 303 && res.status !== 200) {
    throw new Error(`cancel action returned ${res.status}`);
  }
}

const DOWNLOADING = new Set([statusPhrase('Downloading')]);

describe('non-blocking download observation (head-of-line isolation, prompt cancel)', () => {
  beforeAll(async () => {
    seedStagedFixture();
    await admin('POST', '/mappings', HOLD_MAPPING);
    await admin('PUT', '/scenarios/transfer/state', { state: 'Hold' });
    await waitForOk(BASE_URL);
  });

  afterAll(async () => {
    // The Hold mapping is registered ad hoc and survives a scenario reset. A mappings RESET
    // reloads the file-based stubs and drops every ad-hoc registration (deleting by
    // scenarioName would also delete the permanent transfers-poll mappings, which share the
    // `transfer` scenario) — a future phase inherits exactly the on-disk stub.
    await admin('POST', '/mappings/reset');
  });

  it('resolves, searches, and downloads a second acquisition while one transfer holds — and cancels the held one promptly', async () => {
    // Acquisition A: its transfer holds mid-flight indefinitely (the slow healthy album).
    const held = await submitAcquisition(MBID);
    await pollForStatus(held, DOWNLOADING);

    // Acquisition B: submitted while A is mid-transfer. Its resolution (MB stub), search, and
    // enqueue must all run — the exact work the incident showed frozen behind the mutex.
    const second = await submitAcquisition(MBID);
    await pollForStatus(second, DOWNLOADING, 60_000);
    expect(await readStatus(held)).toBe(statusPhrase('Downloading')); // A is still mid-transfer, unharmed

    // Cancel A while its transfer is provably un-settled: the abort must land promptly instead
    // of waiting out the transfer (pre-change it serialized behind the blocking dispatch). The
    // status flip alone would not discriminate — the cancel command appends outside the reactor —
    // so the stub's journal must show the abort's DELETE actually reaching the source promptly.
    await cancelAcquisition(held);
    await pollForStatus(held, new Set([statusPhrase('Cancelled')]), 30_000);
    await pollUntil(
      async () => (await cancelDeletesSeen()) > 0,
      'the abort’s cancel DELETE to reach the source',
    );

    // Release the held scenario: B's watch observes the settle and the freed pipeline carries it
    // through validation, deposit, the seam, and beets to the library.
    await admin('PUT', '/scenarios/transfer/state', { state: 'Completed' });
    expect(await pollUntilTerminal(second, 180_000)).toBe(IMPORT_VOICE_PHRASE.applied);
  });
});
