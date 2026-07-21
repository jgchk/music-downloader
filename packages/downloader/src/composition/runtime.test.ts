import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { okAsync, ok } from 'neverthrow';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { openEventDatabase } from '../adapters/index.js';
import type { EffectPorts } from '../application/acquisition/interpreter.js';
import { silentLogger } from '../application/__fixtures__/fakes.js';
import { createLogger } from '../application/logging/logger.js';
import type { DownloadResult } from '../application/ports/outbound-ports.js';
import {
  matchingCandidate,
  sampleTarget,
} from '../domain/acquisition/__fixtures__/acquisition-fixtures.js';
import type { ProbedAudio } from '../domain/validation/validators.js';
import type { SeamEvent, SeamFeed } from '../application/events/catch-up-subscription.js';
import { createDownloaderRuntime } from './runtime.js';
import type { DownloaderRuntime } from './runtime.js';

/**
 * The runtime factory under test: the composed-process construction path (merge-modular-monolith
 * D8) — store, projections, reactor, seam surfaces — driven end to end with fake effect ports.
 * The composed product entry (packages/web) calls exactly this factory; these tests are its
 * wiring proof: an acquisition submitted through the facade is fulfilled by the reactor, appears
 * on the outbound feed, fires the post-commit wakeup, and a verdict consumed from the importer's
 * feed revives it — all against a runtime built by the factory, not hand-wired.
 */

const FILES = [
  { path: 'staging/01.flac', name: '01.flac' },
  { path: 'staging/02.flac', name: '02.flac' },
];
const PROBES: Record<string, ProbedAudio> = {
  'staging/01.flac': { decodedCleanly: true, codec: 'flac', durationMs: 251000 },
  'staging/02.flac': { decodedCleanly: true, codec: 'flac', durationMs: 264000 },
};
const COMPLETED: DownloadResult = { kind: 'completed', files: FILES };

function fakePorts(): EffectPorts {
  return {
    metadata: { resolve: () => okAsync({ kind: 'resolved', target: sampleTarget }) },
    search: { search: () => okAsync([matchingCandidate('seeder')]) },
    download: {
      download: (_id, _candidate, _policy, onProgress) => {
        onProgress({ percent: 100, bytesTransferred: 1, bytesTotal: 1 });
        return okAsync(COMPLETED);
      },
      abort: () => okAsync([]),
    },
    probe: { probe: (path) => okAsync(PROBES[path]!) },
    library: {
      import: () => okAsync({ kind: 'imported', location: '/library/x' }),
      discardStaging: () => okAsync<void>(undefined),
    },
  };
}

const SUBMIT = { request: { kind: 'musicbrainz', mbid: 'mbid-1', targetType: 'album' } };

const cleanups: (() => void | Promise<void>)[] = [];
afterEach(async () => {
  for (const cleanup of cleanups.splice(0)) await cleanup();
});

async function testRuntime(databaseFile = ':memory:'): Promise<DownloaderRuntime> {
  const runtime = await createDownloaderRuntime(
    {
      databaseFile,
      libraryRoot: '/library',
      stagingRoot: '/staging',
      musicbrainz: {},
      slskd: {},
    },
    silentLogger(),
    { ports: fakePorts() },
  );
  cleanups.push(() => runtime.stop());
  return runtime;
}

async function untilFulfilled(runtime: DownloaderRuntime, id: string): Promise<void> {
  await vi.waitFor(() => {
    const status = runtime.facade.getAcquisition({ id });
    if (!status.ok) throw new Error('not found yet');
    expect(status.value.status).toBe('Fulfilled');
  });
}

describe('createDownloaderRuntime', () => {
  it('drives a submitted acquisition to fulfilment and exposes it on the seam surfaces', async () => {
    const runtime = await testRuntime();
    const wokeUp = vi.fn();
    cleanups.push(runtime.wakeups.subscribe(wokeUp));

    const submitted = await runtime.facade.submitAcquisition(SUBMIT);
    expect(submitted.ok).toBe(true);
    if (!submitted.ok) return;
    const id = submitted.value.acquisitionId;

    await untilFulfilled(runtime, id);
    expect(wokeUp).toHaveBeenCalled();

    // Progress flowed through the runtime's onProgress wiring into the read model.
    const progress = runtime.facade.getAcquisitionProgress({ id });
    expect(progress.ok).toBe(true);

    // The fulfilment is published on the outbound feed with its self-contained payload.
    const batch = await runtime.feed.read(0, 100);
    expect(batch.isOk()).toBe(true);
    const events = batch._unsafeUnwrap().events;
    expect(events.map((event) => event.type)).toContain('acquisition.fulfilled');
  });

  it('consumes importer verdicts over the connected feed and revives the acquisition', async () => {
    const runtime = await testRuntime();
    const submitted = await runtime.facade.submitAcquisition(SUBMIT);
    if (!submitted.ok) throw new Error('submit failed');
    const id = submitted.value.acquisitionId;
    await untilFulfilled(runtime, id);

    const fulfilled = (await runtime.feed.read(0, 100))._unsafeUnwrap().events.at(-1)!;
    const candidate = (fulfilled.data as { candidate: unknown }).candidate;
    const verdict: SeamEvent = {
      globalSeq: 1,
      type: 'release.verdict',
      timestamp: '2026-07-03T12:00:00.000Z',
      data: {
        acquisitionId: id,
        candidate,
        verdict: 'rejected',
        reasons: ['wrong pressing'],
      },
    };
    const feed: SeamFeed = {
      read: (from) =>
        Promise.resolve(ok({ events: from < 1 ? [verdict] : [], scannedTo: Math.max(from, 1) })),
    };
    const subscription = runtime.connectVerdictFeed(feed, { subscribe: () => () => undefined });
    await subscription.start();
    cleanups.push(() => subscription.stop());

    await vi.waitFor(() => {
      const status = runtime.facade.getAcquisition({ id });
      if (!status.ok) throw new Error('missing');
      expect(status.value.status).not.toBe('Fulfilled');
    });
  });

  it('rebuilds projections from the stored backlog on a fresh boot over the same file', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'runtime-'));
    cleanups.push(() => rmSync(dir, { recursive: true, force: true }));
    const file = join(dir, 'events.db');

    const first = await testRuntime(file);
    const submitted = await first.facade.submitAcquisition(SUBMIT);
    if (!submitted.ok) throw new Error('submit failed');
    await untilFulfilled(first, submitted.value.acquisitionId);
    await first.stop();

    const second = await testRuntime(file);
    const listed = second.facade.listAcquisitions().acquisitions;
    expect(listed.map((entry) => entry.acquisitionId)).toContain(submitted.value.acquisitionId);
  });

  it('constructs real adapters when no overrides are given', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'runtime-'));
    cleanups.push(() => rmSync(dir, { recursive: true, force: true }));
    const runtime = await createDownloaderRuntime(
      {
        databaseFile: join(dir, 'data', 'events.db'),
        libraryRoot: join(dir, 'library'),
        stagingRoot: join(dir, 'staging'),
        musicbrainz: {},
        slskd: {},
      },
      silentLogger(),
    );
    cleanups.push(() => runtime.stop());
    expect(runtime.facade.listAcquisitions()).toEqual({ acquisitions: [] });
  });

  it('logs and continues when the projection rebuild cannot read the backlog', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'runtime-'));
    cleanups.push(() => rmSync(dir, { recursive: true, force: true }));
    const file = join(dir, 'events.db');
    const seed = openEventDatabase(file);
    seed
      .prepare(
        `INSERT INTO events (stream_id, version, type, schema_version, data, metadata)
         VALUES ('acq-x', 1, 'Broken', 1, 'not-json', 'also-not-json')`,
      )
      .run();
    seed.close();

    const errors: string[] = [];
    const logger = createLogger({
      level: 'error',
      destination: { write: (line: string) => void errors.push(line) },
    });
    const runtime = await createDownloaderRuntime(
      {
        databaseFile: file,
        libraryRoot: '/library',
        stagingRoot: '/staging',
        musicbrainz: {},
        slskd: {},
      },
      logger,
      { ports: fakePorts() },
    );
    cleanups.push(() => runtime.stop());
    expect(errors.join('')).toContain('projection rebuild failed');
  });
});
