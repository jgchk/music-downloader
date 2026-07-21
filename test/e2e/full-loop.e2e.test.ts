import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { beforeAll, describe, expect, it } from 'vitest';
import {
  BASE_URL,
  DEPOSIT_DIR,
  DOWNLOADER_DB,
  IMPORTER_DB,
  LIBRARY_DIR,
  MBID,
  STAGED_SUBDIR,
  countEvents,
  eventTypes,
  pollForEvent,
  pollUntilTerminal,
  reviewQueueEmpty,
  seedStagedFixture,
  submitAcquisition,
  waitForOk,
} from './helpers.js';

/**
 * Out-of-process full-loop E2E (merge-modular-monolith, out-of-process-e2e spec): drives the REAL
 * published image over a real TCP socket through the web interface — the product's only surface —
 * with both module runtimes, the cross-module subscriptions, and both on-disk SQLite stores live.
 * Only slskd + MusicBrainz are stubbed (WireMock, including the beets-facing ws/2 XML endpoint);
 * ffmpeg, the filesystem deposit, the seam handoff, and beets' propose→auto-apply all run for real.
 *
 * The slskd stub reports the completed download's on-disk location (events.json `localFilename`
 * under the options.json downloads root); the harness seeds the fixture at exactly that reported
 * location re-rooted onto the shared staging mount — NOT at a path recomputed from the adapter's
 * own logic — so a regression reintroducing a recomputed/mismatched location fails here.
 */

const SLSKD_ADMIN = process.env['E2E_SLSKD_ADMIN_URL'] ?? 'http://localhost:8082/__admin';

async function slskdDeletes(): Promise<string[]> {
  const res = await fetch(`${SLSKD_ADMIN}/requests`, { signal: AbortSignal.timeout(2000) });
  const body = (await res.json()) as { requests: { request: { method: string; url: string } }[] };
  return body.requests
    .map((entry) => entry.request)
    .filter((request) => request.method === 'DELETE')
    .map((request) => request.url);
}

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

describe('out-of-process full loop (web interface, real socket)', () => {
  beforeAll(async () => {
    seedStagedFixture();
    await waitForOk(`${SLSKD_ADMIN}/mappings`);
    await waitForOk(BASE_URL);
  });

  it('drives intent → download → deposit → seam → beets import to a terminal outcome', async () => {
    const acquisitionId = await submitAcquisition(MBID);

    // Downloader side: resolve (MB stub) → search/rank/download (slskd stub, stateful poll) →
    // real ffmpeg probe of the seeded FLAC → real filesystem deposit → Fulfilled over the UI.
    const status = await pollUntilTerminal(acquisitionId);
    expect(status).toBe('Fulfilled');
    expect(existsSync(join(DEPOSIT_DIR, 'Test_Artist', 'Test_Album_(2020)'))).toBe(true);

    // Seam handoff: the importer's catch-up subscription consumed acquisition.fulfilled and
    // submitted the import through the native path — visible in its own durable store.
    await pollForEvent(IMPORTER_DB, 'ImportRequested');

    // Importer side: real beets (inside the image, MusicBrainz pointed at the stub's ws/2 XML)
    // proposes the hint-pinned candidate and auto-applies it into the beets library.
    await pollForEvent(IMPORTER_DB, 'ImportApplied', 120_000);
    expect(existsSync(LIBRARY_DIR)).toBe(true);

    // Terminal outcome observable over the interface: the acquisition reports Fulfilled and the
    // review queue's explicit empty marker proves nothing waits on a human.
    expect(await reviewQueueEmpty()).toBe(true);

    // The stores are durable files, not :memory: — both modules' events are on disk, and the
    // whole flow recorded exactly one import for the one acquisition.
    expect(eventTypes(DOWNLOADER_DB).length).toBeGreaterThan(0);
    expect(countEvents(IMPORTER_DB, 'ImportRequested')).toBe(1);
    expect(countEvents(IMPORTER_DB, 'ImportApplied')).toBe(1);

    // Source-resource stewardship survives the merge: the app deletes the search it created and
    // removes the completed transfer's record — and touches no resource it does not own.
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
  });
});
