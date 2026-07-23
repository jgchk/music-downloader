import { mkdirSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { errAsync, ok, okAsync } from 'neverthrow';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { openEventDatabase } from '../adapters/sqlite/schema.js';
import { InProcessEventBus } from '../adapters/sqlite/event-bus.js';
import { SqliteCheckpointStore, SqliteEventStore } from '../adapters/sqlite/event-store.js';
import { SqliteDeadLetterStore } from '../adapters/sqlite/dead-letters.js';
import { UpcasterRegistry } from '../adapters/sqlite/upcaster.js';
import { fixedClock, silentLogger } from '../application/__fixtures__/fakes.js';
import { createLogger } from '../application/logging/logger.js';
import { infraError } from '../application/ports/errors.js';
import { REACTOR_CONSUMER } from '../application/import/reactor.js';
import type {
  ConfigInvalid,
  TaggerConfig,
  TaggerPort,
} from '../application/ports/outbound-ports.js';
import type { SeamEvent, SeamFeed } from '../application/events/catch-up-subscription.js';
import { requested } from '../domain/import/__fixtures__/import-fixtures.js';
import { createImporterRuntime } from './runtime.js';
import type { ImporterRuntime, ImporterRuntimeConfig } from './runtime.js';

/**
 * The runtime factory under test: the composed-process construction path (merge-modular-monolith
 * D8) — validated bridge, store, projection, reactor, seam surfaces — driven with a fake tagger.
 * The composed product entry (packages/web) calls exactly this factory; these tests are its
 * wiring proof, including the intake subscription consuming a downloader fulfilment end to end.
 */

const BEETS_CONFIG: TaggerConfig = {
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
  for (const cleanup of cleanups) await cleanup();
  cleanups.length = 0;
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

  /**
   * Seed a legacy on-disk DB: the import exists, its effect was dead-lettered (the reactor
   * checkpoint already advanced past it), and a dead letter naming the import stream is on record
   * with `letterOccurredAt`. Boot the runtime over it with a fixed clock, so the retention horizon
   * (clock.now − retention) is deterministic, and return the runtime for a facade query.
   */
  async function bootOverDeadLetter(
    letterOccurredAt: string,
    overrides: Partial<ImporterRuntimeConfig> = {},
  ): Promise<ImporterRuntime> {
    const directory = mkdtempSync(path.join(tmpdir(), 'importer-db-'));
    cleanups.push(() => rmSync(directory, { recursive: true, force: true }));
    const databaseFile = path.join(directory, 'events.db');

    const database = openEventDatabase(databaseFile);
    const store = new SqliteEventStore(
      database,
      new UpcasterRegistry(),
      new InProcessEventBus(silentLogger()),
    );
    const appendResult = await store.append('imp-stalled', 0, [requested()], {
      importId: 'imp-stalled',
      occurredAt: '2026-07-10T12:00:00.000Z',
    });
    appendResult._unsafeUnwrap();
    const saveResult = await new SqliteCheckpointStore(database).save(REACTOR_CONSUMER, 1);
    saveResult._unsafeUnwrap();
    const recordResult = await new SqliteDeadLetterStore(database).record({
      subscription: REACTOR_CONSUMER,
      globalSeq: 1,
      error: 'Propose: bridge.propose: beets down',
      occurredAt: letterOccurredAt,
      streamId: 'imp-stalled',
    });
    recordResult._unsafeUnwrap();
    database.close();

    const result = await createImporterRuntime(
      config({ databaseFile, ...overrides }),
      silentLogger(),
      {
        tagger: fakeTagger(),
        intake: { deleteRelease: () => okAsync<void>(undefined) },
        clock: fixedClock(), // 2026-07-18T12:00:00Z — retention horizon is now deterministic
      },
    );
    const runtime = result._unsafeUnwrap();
    cleanups.push(() => runtime.stop());
    return runtime;
  }

  it('seeds a dead-lettered import as stalled from the store at boot (reactor-durability parity)', async () => {
    // A dead letter within the retention window survives the boot prune and seeds the stalled flag.
    const runtime = await bootOverDeadLetter('2026-07-15T12:00:00.000Z');

    const view = runtime.facade.getImport({ id: 'imp-stalled' });
    expect(view.ok).toBe(true);
    if (view.ok) expect(view.value.stalled).toBe(true);
  });

  it('does not seed an import stalled from a dead letter older than the retention horizon', async () => {
    // A 60-day-old letter with a 30-day retention: pruned at boot before seeding, so it never stalls.
    const runtime = await bootOverDeadLetter('2026-05-19T12:00:00.000Z', {
      stalledRetentionMs: 30 * 24 * 60 * 60 * 1000,
    });

    const view = runtime.facade.getImport({ id: 'imp-stalled' });
    expect(view.ok).toBe(true);
    if (view.ok) expect(view.value.stalled).toBeUndefined();
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

  it('surfaces an operator-fixable ConfigInvalid as a BeetsConfigUnusable startup error with its detail', async () => {
    const result = await createImporterRuntime(config(), silentLogger(), {
      tagger: {
        ...fakeTagger(),
        validate: () =>
          errAsync<TaggerConfig, ConfigInvalid>({
            kind: 'ConfigInvalid',
            detail: 'library-directory-missing: not a directory',
          }),
      },
    });
    expect(result.isErr()).toBe(true);
    const startupError = result._unsafeUnwrapErr();
    expect(startupError.kind).toBe('BeetsConfigUnusable');
    expect(startupError.detail).toContain('library-directory-missing');
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
    const directory = mkdtempSync(path.join(tmpdir(), 'intake-'));
    cleanups.push(() => rmSync(directory, { recursive: true, force: true }));
    mkdirSync(path.join(directory, 'album'), { recursive: true });

    const result = await createImporterRuntime(config({ intakeRoot: directory }), silentLogger(), {
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
    const directory = mkdtempSync(path.join(tmpdir(), 'intake-'));
    cleanups.push(() => rmSync(directory, { recursive: true, force: true }));

    const result = await createImporterRuntime(config({ intakeRoot: directory }), silentLogger(), {
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
    const directory = mkdtempSync(path.join(tmpdir(), 'importer-runtime-'));
    cleanups.push(() => rmSync(directory, { recursive: true, force: true }));
    const file = path.join(directory, 'events.db');
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

  it('stops the connected acquisition subscription on stop() so its poll cannot outlive the db', async () => {
    vi.useFakeTimers();
    try {
      const result = await createImporterRuntime(config(), silentLogger(), {
        tagger: fakeTagger(),
        intake: { deleteRelease: () => okAsync<void>(undefined) },
      });
      const runtime = result._unsafeUnwrap();
      let isStopped = false;
      const stopOnce = async (): Promise<void> => {
        if (isStopped) return;
        isStopped = true;
        await runtime.stop();
      };
      cleanups.push(stopOnce);

      // A state-based fake feed counting its reads — no interaction spy: the observable proof is
      // that the feed is polled zero more times after stop(), so nothing hits the closed DB handle.
      const reads: number[] = [];
      const feed: SeamFeed = {
        read: (from) => {
          reads.push(from);
          return Promise.resolve(ok({ events: [], scannedTo: from }));
        },
      };
      const subscription = runtime.connectAcquisitionFeed(feed, { sourceRoot: '/staging' });
      await subscription.start();
      const readsAtStop = reads.length;

      await stopOnce(); // must clear the subscription's poll interval BEFORE closing the db
      await vi.advanceTimersByTimeAsync(30_000); // several 5s poll intervals would fire if leaked

      expect(reads.length).toBe(readsAtStop);
    } finally {
      vi.useRealTimers();
    }
  });

  it('classifies a genuine probe fault as transient (not a missing directory) via the real probe', async () => {
    const directory = mkdtempSync(path.join(tmpdir(), 'intake-'));
    cleanups.push(() => rmSync(directory, { recursive: true, force: true }));

    const result = await createImporterRuntime(config({ intakeRoot: directory }), silentLogger(), {
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
        location: `/staging/${String.fromCodePoint(0)}bad`,
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
