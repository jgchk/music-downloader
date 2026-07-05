import { copyFileSync, existsSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { beforeAll, describe, expect, it } from 'vitest';
import { candidateStagingDir } from '../../src/adapters/filesystem/paths.js';
import type { CandidateIdentity } from '../../src/domain/candidate/candidate.js';

/**
 * Out-of-process E2E (change: add-out-of-process-e2e). Drives the REAL built image over a real
 * HTTP socket with the reactor and on-disk SQLite live; only slskd + MusicBrainz are stubbed
 * (WireMock). The whole cascade — resolve → search → rank → download → validate → import — runs
 * for real, including the real ffmpeg probe of a real FLAC and the real filesystem import.
 *
 * The harness (docker-compose.test.yml, brought up by test/e2e/run.sh) shares ./.e2e-tmp with the
 * container as /data, so this test seeds the downloaded file where the app will look for it.
 */

const BASE_URL = process.env['TARGET_BASE_URL'] ?? 'http://localhost:3000';
const SLSKD_ADMIN = process.env['SLSKD_ADMIN_URL'] ?? 'http://localhost:8082/__admin';
const DATA_DIR = process.env['E2E_DATA_DIR'] ?? join(process.cwd(), '.e2e-tmp');
const STAGING_DIR = join(DATA_DIR, 'staging');

// Must agree with the WireMock slskd fixtures (test/e2e/stubs/slskd/mappings): the search response
// advertises this peer, folder path, total size, and a single .flac file.
const IDENTITY: CandidateIdentity = {
  username: 'peer1',
  path: '@@music\\Test Artist\\Test Album',
  sizeBytes: 1234567,
};
const FILE_NAME = '01 Track One.flac';
const FIXTURE = fileURLToPath(new URL('./fixtures/track.flac', import.meta.url));

const SUBMIT_BODY = {
  request: { kind: 'musicbrainz', mbid: 'release-1', targetType: 'album' },
};

async function waitForOk(url: string, timeoutMs = 60_000): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    try {
      // Bound each attempt: a port that is open but not yet answering must not hang the poll.
      const res = await fetch(url, { signal: AbortSignal.timeout(2000) });
      if (res.ok) return;
    } catch {
      // not up yet
    }
    if (Date.now() >= deadline) throw new Error(`timed out waiting for ${url}`);
    await new Promise((resolve) => setTimeout(resolve, 500));
  }
}

interface StatusView {
  readonly status: string;
  readonly location?: string;
}

async function pollUntilTerminal(id: string, timeoutMs = 60_000): Promise<StatusView> {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    const res = await fetch(`${BASE_URL}/api/v1/acquisitions/${id}`, {
      signal: AbortSignal.timeout(2000),
    });
    if (res.ok) {
      const view = (await res.json()) as StatusView;
      if (
        view.status === 'Fulfilled' ||
        view.status === 'Exhausted' ||
        view.status === 'Conflicted'
      ) {
        return view;
      }
    }
    if (Date.now() >= deadline) throw new Error(`acquisition ${id} did not settle in time`);
    await new Promise((resolve) => setTimeout(resolve, 500));
  }
}

async function slskdDeletes(): Promise<string[]> {
  const res = await fetch(`${SLSKD_ADMIN}/requests`, { signal: AbortSignal.timeout(2000) });
  const body = (await res.json()) as { requests: { request: { method: string; url: string } }[] };
  return body.requests
    .map((entry) => entry.request)
    .filter((request) => request.method === 'DELETE')
    .map((request) => request.url);
}

/** Poll the slskd stub's request journal until `predicate` holds over the recorded DELETEs. */
async function waitForDeletes(
  predicate: (deletes: string[]) => boolean,
  timeoutMs = 15_000,
): Promise<string[]> {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    const deletes = await slskdDeletes();
    if (predicate(deletes)) return deletes;
    if (Date.now() >= deadline)
      throw new Error(`slskd DELETEs never matched: ${deletes.join(', ')}`);
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
}

describe('out-of-process acquisition E2E (HTTP)', () => {
  beforeAll(async () => {
    // Seed the "downloaded" file where the real download adapter will report it, using the app's
    // own path function so the location cannot drift from production.
    const dir = candidateStagingDir(STAGING_DIR, IDENTITY);
    mkdirSync(dir, { recursive: true });
    copyFileSync(FIXTURE, join(dir, FILE_NAME));

    await waitForOk('http://localhost:8081/__admin/mappings'); // mb-stub
    await waitForOk('http://localhost:8082/__admin/mappings'); // slskd-stub
    await waitForOk(`${BASE_URL}/api/v1/acquisitions`); // app
  });

  it('fulfills an acquisition end to end over a real socket, through real ffmpeg + import', async () => {
    const submit = await fetch(`${BASE_URL}/api/v1/acquisitions`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(SUBMIT_BODY),
    });
    expect(submit.status).toBe(202);
    const { acquisitionId } = (await submit.json()) as { acquisitionId: string };
    expect(acquisitionId).toBeTruthy();

    const view = await pollUntilTerminal(acquisitionId);
    expect(view.status).toBe('Fulfilled');
    expect(view.location).toContain(join('Test_Artist', 'Test_Album_(2020)'));

    // The real filesystem adapter imported the real bytes into the library on the shared volume.
    expect(existsSync(join(DATA_DIR, 'library', 'Test_Artist', 'Test_Album_(2020)'))).toBe(true);

    // The store is durable, not in-memory: events were persisted to an on-disk SQLite file.
    expect(existsSync(join(DATA_DIR, 'events.db'))).toBe(true);

    // The Imported cleanup removes the now-empty candidate staging directory. It is dispatched
    // around the same time the status turns Fulfilled, so poll briefly for the directory to vanish.
    const stagingDir = candidateStagingDir(STAGING_DIR, IDENTITY);
    const deadline = Date.now() + 10_000;
    while (existsSync(stagingDir) && Date.now() < deadline) {
      await new Promise((resolve) => setTimeout(resolve, 200));
    }
    expect(existsSync(stagingDir)).toBe(false);

    // Source-resource stewardship: the app deletes the search it created and removes the completed
    // transfer's record — and issues no DELETE against any resource it does not own.
    const deletes = await waitForDeletes(
      (urls) =>
        urls.some((url) => url === '/api/v0/searches/search-1') &&
        urls.some((url) => url.startsWith('/api/v0/transfers/downloads/peer1/transfer-1')),
    );
    expect(
      deletes.every(
        (url) => url.includes('/searches/search-1') || url.includes('/peer1/transfer-1'),
      ),
    ).toBe(true);
    expect(deletes.find((url) => url.includes('/peer1/transfer-1'))?.includes('remove=true')).toBe(
      true,
    );
  });
});
