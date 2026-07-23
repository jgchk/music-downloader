import { mkdirSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { errAsync, ok, okAsync } from 'neverthrow';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { openEventDatabase } from '../adapters/sqlite/schema.js';
import { fixedClock, silentLogger } from '../application/__fixtures__/fakes.js';
import { createLogger } from '../application/logging/logger.js';
import { infraError } from '../application/ports/errors.js';
import type { TaggerConfiguration, TaggerPort } from '../application/ports/outbound-ports.js';
import type { SeamEvent, SeamFeed } from '../application/events/catch-up-subscription.js';
import { createImporterRuntime } from './runtime.js';
import type { ImporterRuntime, ImporterRuntimeConfig } from './runtime.js';

/**
 * The runtime factory under test: the composed-process construction path (merge-modular-monolith
 * D8) — validated bridge, store, projection, reactor, seam surfaces — driven with a fake tagger.
 * The composed product entry (packages/web) calls exactly this factory; these tests are its
 * wiring proof, including the intake subscription consuming a downloader fulfilment end to end.
 */

const BEETS_CONFIG: TaggerConfiguration = {
  beetsVersion: '2.4.0',
  libraryDatabase: '/data/library.db',
  libraryDirectory: '/music',
  plugins: [],
  overlay: {},
};

function fakeTagger(): TaggerPort {
  return {
    validate: () => okAsync(BEETS_CONFIG),
    propose: () => okAsync({ kind: 'proposal' as const, candidates: [], duplicates: [] }),
    apply: () => errAsync(infraError('apply', 'unused in runtime tests')),
  };
}

const cleanups: (() => void | Promise<void>)[] = [];
afterEach(async () => {
  for (const cleanup of cleanups.splice(0)) await cleanup();
});

function config(overrides: Partial<ImporterRuntimeConfig> = {}): ImporterRuntimeConfig {
  return {
    databaseFile: ':memory:',
    intakeRoot: '/intake',
    beetsConfigPath: '/config/beets.yaml',
    bridgePython: 'python3',
    bridgeTimeoutMs: 1000,
    autoApplyThreshold: 0.04,
    ...overrides,
  };
}

async function testRuntime(): Promise<ImporterRuntime> {
  const result = await createImporterRuntime(config(), silentLogger(), {
    tagger: fakeTagger(),
    intake: { deleteRelease: () => okAsync<void>(undefined) },
  });
  const runtime = result._unsafeUnwrap();
  cleanups.push(() => runtime.stop());
  return runtime;
}

describe('createImporterRuntime', () => {
  it('boots with a validated bridge and drives a submitted import through the reactor', async () => {
    const runtime = await testRuntime();
    expect(runtime.beetsConfig).toEqual(BEETS_CONFIG);

    const wokeUp = vi.fn();
    cleanups.push(runtime.wakeups.subscribe(wokeUp));

    const submitted = await runtime.facade.submitImport({ path: '/intake/album' });
    expect(submitted.ok).toBe(true);
    if (!submitted.ok) return;

    // The no-match proposal routes to review — visible through the projection-backed facade.
    await vi.waitFor(() => {
      expect(runtime.facade.listPendingReviews().reviews).toHaveLength(1);
    });
    expect(wokeUp).toHaveBeenCalled();
  });

  it('returns the startup error as a value when the beets config is unusable', async () => {
    const result = await createImporterRuntime(config(), silentLogger(), {
      tagger: {
        ...fakeTagger(),
        validate: () => errAsync(infraError('validate', 'bad yaml')),
      },
    });
    expect(result.isErr()).toBe(true);
    const startupError = result._unsafeUnwrapErr();
    expect(startupError.kind).toBe('BeetsConfigUnusable');
    expect(startupError.detail).toContain('bad yaml');
  });

  it('refuses to boot on an out-of-range auto-apply threshold', async () => {
    const result = await createImporterRuntime(
      config({ autoApplyThreshold: 1.5 }),
      silentLogger(),
      {
        tagger: fakeTagger(),
      },
    );
    expect(result.isErr()).toBe(true);
    const startupError = result._unsafeUnwrapErr();
    expect(startupError.kind).toBe('InvalidAutoApplyThreshold');
    if (startupError.kind === 'InvalidAutoApplyThreshold') {
      expect(startupError.detail).toContain('1.5');
    }
  });

  it('consumes a downloader fulfilment over the connected feed into a native import', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'intake-'));
    cleanups.push(() => rmSync(dir, { recursive: true, force: true }));
    mkdirSync(join(dir, 'album'), { recursive: true });

    const result = await createImporterRuntime(config({ intakeRoot: dir }), silentLogger(), {
      tagger: fakeTagger(),
      clock: fixedClock(),
    });
    const runtime = result._unsafeUnwrap();
    cleanups.push(() => runtime.stop());

    const fulfilled: SeamEvent = {
      globalSeq: 1,
      type: 'acquisition.fulfilled',
      timestamp: '2026-07-18T12:00:00.000Z',
      data: {
        acquisitionId: 'acq-1',
        location: '/staging/album',
        target: { type: 'album', artist: 'Artist', title: 'Album', musicbrainzReleaseId: null },
      },
    };
    const feed: SeamFeed = {
      read: (from) =>
        Promise.resolve(ok({ events: from < 1 ? [fulfilled] : [], scannedTo: Math.max(from, 1) })),
    };
    const subscription = runtime.connectAcquisitionFeed(feed, { sourceRoot: '/staging' });
    await subscription.start();
    cleanups.push(() => subscription.stop());

    await vi.waitFor(() => {
      expect(runtime.facade.listImports().imports).toHaveLength(1);
    });
  });

  it('holds delivery when the re-rooted directory is not visible yet (real filesystem probe)', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'intake-'));
    cleanups.push(() => rmSync(dir, { recursive: true, force: true }));

    const result = await createImporterRuntime(config({ intakeRoot: dir }), silentLogger(), {
      tagger: fakeTagger(),
      clock: fixedClock(),
    });
    const runtime = result._unsafeUnwrap();
    cleanups.push(() => runtime.stop());

    const missing: SeamEvent = {
      globalSeq: 1,
      type: 'acquisition.fulfilled',
      timestamp: '2026-07-18T12:00:00.000Z',
      data: {
        acquisitionId: 'acq-2',
        location: '/staging/not-there-yet',
        target: { type: 'album', artist: 'Artist', title: 'Album', musicbrainzReleaseId: null },
      },
    };
    const feed: SeamFeed = {
      read: (from) =>
        Promise.resolve(ok({ events: from < 1 ? [missing] : [], scannedTo: Math.max(from, 1) })),
    };
    const subscription = runtime.connectAcquisitionFeed(feed, { sourceRoot: '/staging' });
    await subscription.start();
    cleanups.push(() => subscription.stop());

    // The directory never appears: the checkpoint holds and no import is created.
    expect(runtime.facade.listImports().imports).toHaveLength(0);
  });

  it('constructs the real bridge when no tagger override is given, surfacing its failure as a value', async () => {
    const result = await createImporterRuntime(
      config({ bridgePython: '/bin/false', bridgeTimeoutMs: 2000 }),
      silentLogger(),
    );
    expect(result.isErr()).toBe(true);
    expect(result._unsafeUnwrapErr().kind).toBe('BeetsConfigUnusable');
  });

  it('reports readiness up on a freshly booted runtime (value, no throw)', async () => {
    const runtime = await testRuntime();
    expect(runtime.readiness()).toEqual({ status: 'up' });
  });

  it('reports readiness down once the acquisition subscription halts on a poison event', async () => {
    const runtime = await testRuntime();
    // A known-type event with a malformed payload is a producer contract defect the intake
    // consumer poisons; the `halt` policy stops the subscription without advancing.
    const poison: SeamEvent = {
      globalSeq: 1,
      type: 'acquisition.fulfilled',
      timestamp: '2026-07-18T12:00:00.000Z',
      data: { not: 'a valid fulfilment' },
    };
    const feed: SeamFeed = {
      read: (from) =>
        Promise.resolve(ok({ events: from < 1 ? [poison] : [], scannedTo: Math.max(from, 1) })),
    };
    const subscription = runtime.connectAcquisitionFeed(feed, { sourceRoot: '/staging' });
    await subscription.start();
    cleanups.push(() => subscription.stop());

    expect(subscription.isHalted).toBe(true);
    expect(runtime.readiness()).toEqual({ status: 'down' });
  });

  it('reads readiness with no side effects on repeated probes', async () => {
    const runtime = await testRuntime();
    expect(runtime.readiness()).toEqual({ status: 'up' });
    expect(runtime.readiness()).toEqual({ status: 'up' });
    // A pure read of runtime state advances no stream and creates no work.
    expect(runtime.facade.listImports()).toEqual({ imports: [] });
  });

  it('refuses to boot when the projection rebuild cannot read the backlog', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'importer-runtime-'));
    cleanups.push(() => rmSync(dir, { recursive: true, force: true }));
    const file = join(dir, 'events.db');
    const seed = openEventDatabase(file);
    seed
      .prepare(
        `INSERT INTO events (stream_id, version, type, schema_version, data, metadata)
         VALUES ('imp-x', 1, 'Broken', 1, 'not-json', 'also-not-json')`,
      )
      .run();
    seed.close();

    const errors: string[] = [];
    const logger = createLogger({
      level: 'error',
      destination: { write: (line: string) => void errors.push(line) },
    });
    const result = await createImporterRuntime(config({ databaseFile: file }), logger, {
      tagger: fakeTagger(),
      clock: fixedClock(),
    });

    // A half-rebuilt projection would boot half-blind (broken idempotency index, empty queries)
    // with readiness still `up`: fail the boot loudly instead, as an unusable beets config does.
    expect(result.isErr()).toBe(true);
    expect(result._unsafeUnwrapErr().kind).toBe('ProjectionRebuildFailed');
    expect(errors.join('')).toContain('projection rebuild failed');
  });

  it('stops the connected acquisition subscription on shutdown (no leaked poll)', async () => {
    const result = await createImporterRuntime(config(), silentLogger(), {
      tagger: fakeTagger(),
      intake: { deleteRelease: () => okAsync<void>(undefined) },
    });
    const runtime = result._unsafeUnwrap();
    const feed: SeamFeed = {
      read: (from) => Promise.resolve(ok({ events: [], scannedTo: from })),
    };
    const subscription = runtime.connectAcquisitionFeed(feed, { sourceRoot: '/staging' });
    const stopSpy = vi.spyOn(subscription, 'stop');
    await subscription.start();

    await runtime.stop();

    // stop() must tear down the subscription too — otherwise its fallback poll keeps hitting a
    // closed DB handle and holds the event loop open.
    expect(stopSpy).toHaveBeenCalled();
  });

  it('classifies a genuine probe fault as transient (not a missing directory) via the real probe', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'intake-'));
    cleanups.push(() => rmSync(dir, { recursive: true, force: true }));

    const result = await createImporterRuntime(config({ intakeRoot: dir }), silentLogger(), {
      tagger: fakeTagger(),
      clock: fixedClock(),
    });
    const runtime = result._unsafeUnwrap();
    cleanups.push(() => runtime.stop());

    // A NUL in the delivered location makes the real `stat` throw a non-ENOENT fault: the probe
    // rethrows it (rather than reporting "absent") and the consumer holds it as a transient fault,
    // so no import is created and the subscription is not halted.
    const faulting: SeamEvent = {
      globalSeq: 1,
      type: 'acquisition.fulfilled',
      timestamp: '2026-07-18T12:00:00.000Z',
      data: {
        acquisitionId: 'acq-probe',
        location: `/staging/${String.fromCharCode(0)}bad`,
        target: { type: 'album', artist: 'Artist', title: 'Album', musicbrainzReleaseId: null },
      },
    };
    const feed: SeamFeed = {
      read: (from) =>
        Promise.resolve(ok({ events: from < 1 ? [faulting] : [], scannedTo: Math.max(from, 1) })),
    };
    const subscription = runtime.connectAcquisitionFeed(feed, { sourceRoot: '/staging' });
    await subscription.start();
    cleanups.push(() => subscription.stop());

    expect(runtime.facade.listImports().imports).toHaveLength(0);
    expect(subscription.isHalted).toBe(false);
  });
});
