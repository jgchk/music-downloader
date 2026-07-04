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
      const res = await fetch(url);
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
    const res = await fetch(`${BASE_URL}/api/v1/acquisitions/${id}`);
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
  });
});
