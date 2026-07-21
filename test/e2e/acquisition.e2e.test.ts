import { copyFileSync, existsSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { beforeAll, describe, expect, it } from 'vitest';

/**
 * Out-of-process E2E (change: add-out-of-process-e2e). Drives the REAL built image over a real
 * HTTP socket with the reactor and on-disk SQLite live; only slskd + MusicBrainz are stubbed
 * (WireMock). The whole cascade — resolve → search → rank → download → validate → import — runs
 * for real, including the real ffmpeg probe of a real FLAC and the real filesystem import.
 *
 * The harness (docker-compose.test.yml, brought up by test/e2e/run.sh) shares ./.e2e-tmp with the
 * container as /data. The slskd stub reports the completed download's on-disk location via
 * `GET /api/v0/events` (`DownloadFileComplete.localFilename`, under the `GET /api/v0/options`
 * downloads root); this test seeds the fixture at exactly that reported location — mapped onto the
 * shared staging volume — NOT at a path the adapter recomputes for itself. So the tier exercises the
 * adapter's real event-based resolution: a regression that reintroduced a recomputed or mismatched
 * location would fail here.
 */

const BASE_URL = process.env['TARGET_BASE_URL'] ?? 'http://localhost:3000';
const SLSKD_ADMIN = process.env['SLSKD_ADMIN_URL'] ?? 'http://localhost:8082/__admin';
const DATA_DIR = process.env['E2E_DATA_DIR'] ?? join(process.cwd(), '.e2e-tmp');
const STAGING_DIR = join(DATA_DIR, 'staging');

// The slskd events stub reports `localFilename = /downloads/Test Album/01 Track One.flac` under the
// options downloads root `/downloads`; the app re-roots that onto STAGING_ROOT (/data/staging), so
// the file resolves to <staging>/Test Album/01 Track One.flac. Seed it there, and keep this in
// agreement with test/e2e/stubs/slskd/mappings/{options,events}.json and the transfers-stub id.
const STAGED_SUBDIR = 'Test Album';
const FILE_NAME = '01 Track One.flac';
const STAGED_DIR = join(STAGING_DIR, STAGED_SUBDIR);
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
    // Seed the "downloaded" file at the location the slskd stub reports for it (re-rooted onto the
    // shared staging volume) — the same resolution the real adapter performs from the events log.
    mkdirSync(STAGED_DIR, { recursive: true });
    copyFileSync(FIXTURE, join(STAGED_DIR, FILE_NAME));

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

    // The Imported cleanup removes the emptied staging directory (the files having been moved into
    // the library). It is dispatched around the same time the status turns Fulfilled, so poll
    // briefly for the directory to vanish.
    const deadline = Date.now() + 10_000;
    while (existsSync(STAGED_DIR) && Date.now() < deadline) {
      await new Promise((resolve) => setTimeout(resolve, 200));
    }
    expect(existsSync(STAGED_DIR)).toBe(false);

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
