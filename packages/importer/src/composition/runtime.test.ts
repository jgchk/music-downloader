import { STORY } from '../application/__fixtures__/correlation.js';
import { appendMetadata } from '../application/__fixtures__/correlation.js';
import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { errAsync, ok, okAsync } from 'neverthrow';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { openEventDatabase } from '../adapters/sqlite/schema.js';
import { InProcessEventBus } from '../adapters/sqlite/event-bus.js';
import { SqliteCheckpointStore, SqliteEventStore } from '../adapters/sqlite/event-store.js';
import { SqliteDeadLetterStore } from '../adapters/sqlite/dead-letters.js';
import { UpcasterRegistry } from '../adapters/sqlite/upcaster.js';
import { legacyRejectResolvedData } from '../adapters/sqlite/__fixtures__/legacy-review-resolved.js';
import { fixedClock, silentLogger } from '../application/__fixtures__/fakes.js';
import { createLogger } from '../application/logging/logger.js';
import type { Logger } from '../application/logging/logger.js';
import { infraError } from '../application/ports/errors.js';
import { REACTOR_CONSUMER } from '../application/import/reactor.js';
import type {
  ConfigInvalid,
  TaggerConfig,
  TaggerPort,
} from '../application/ports/outbound-ports.js';
import type { SeamEvent, SeamFeed } from '../application/events/catch-up-subscription.js';
import {
  candidate,
  MATCH_REVIEW,
  proposed,
  requested,
  SOURCE,
} from '../domain/import/__fixtures__/import-fixtures.js';
import { asDistance } from '../domain/shared/__fixtures__/distance.js';
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

const APPLIED_LOCATION = '/music/Artist/Album';

/**
 * A bridge that proposes exactly one candidate at `distance` and applies successfully — the two
 * outcomes the auto-apply routing chooses between.
 */
function taggerProposing(distance: number): TaggerPort {
  return {
    ...fakeTagger(),
    propose: () =>
      okAsync({
        kind: 'proposal' as const,
        candidates: [candidate({ distance: asDistance(distance) })],
        duplicates: [],
      }),
    apply: () => okAsync({ kind: 'applied' as const, location: APPLIED_LOCATION, failures: [] }),
  };
}

/** A logger whose emitted lines the test can read back (the operator's view of the seam). */
function capturingLogger(level: string): { logger: Logger; lines: string[] } {
  const lines: string[] = [];
  const logger = createLogger({
    level,
    destination: { write: (line: string) => void lines.push(line) },
  });
  return { logger, lines };
}

/** The position the gated feed reports having scanned - the save the shutdown races. */
const SCANNED_TO = 7;

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

/** Boot with the given auto-apply bound and a bridge that proposes one candidate at `distance`. */
async function bootProposing(
  autoApplyThreshold: number,
  distance: number,
): Promise<ImporterRuntime> {
  const result = await createImporterRuntime(config({ autoApplyThreshold }), silentLogger(), {
    tagger: taggerProposing(distance),
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

    const submitted = await runtime.facade.submitImport({ path: '/intake/album' }, STORY);
    expect(submitted.ok).toBe(true);
    if (!submitted.ok) return;

    // The no-match proposal routes to review — visible through the projection-backed facade.
    await vi.waitFor(() => {
      expect(runtime.facade.listPendingReviews().reviews).toHaveLength(1);
    });
    expect(wokeUp).toHaveBeenCalled();
  });

  it('stamps its own W3C-trace-shaped story on what it appends when the caller supplies an unusable one', async () => {
    // This factory is the ONE place the module's story format is established — 32 lowercase hex, so
    // a later OpenTelemetry adoption can carry the very same value — and a caller story it cannot
    // use degrades to a freshly minted one rather than refusing the work. Overriding the source in
    // every other test would leave that production mint unspecified: what lands in the log has to be
    // the real format, not merely a value that is present.
    const directory = mkdtempSync(path.join(tmpdir(), 'importer-db-'));
    cleanups.push(() => rmSync(directory, { recursive: true, force: true }));
    const databaseFile = path.join(directory, 'events.db');

    const result = await createImporterRuntime(config({ databaseFile }), silentLogger(), {
      tagger: fakeTagger(),
      intake: { deleteRelease: () => okAsync<void>(undefined) },
    });
    const runtime = result._unsafeUnwrap();
    cleanups.push(() => runtime.stop());

    const submitted = await runtime.facade.submitImport(
      { path: '/intake/album' },
      'not-a-trace-id',
    );
    expect(submitted.ok).toBe(true);
    await vi.waitFor(() => {
      expect(runtime.facade.listPendingReviews().reviews).toHaveLength(1);
    });

    // Read the durable rows back over a second connection (WAL): the story is only real if it is
    // what got persisted, and every event of the cycle has to carry it, not just the first.
    const reader = openEventDatabase(databaseFile);
    const rows = reader.prepare('SELECT metadata FROM events').all() as { metadata: string }[];
    reader.close();

    expect(rows.length).toBeGreaterThan(0);
    for (const row of rows) {
      const { correlationId } = JSON.parse(row.metadata) as { correlationId?: string };
      expect(correlationId).toMatch(/^[0-9a-f]{32}$/);
    }
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
    const appendResult = await store.append(
      'imp-stalled',
      0,
      [requested()],
      appendMetadata('imp-stalled', fixedClock()),
    );
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

  it('upcasts a raw-inserted v1 legacy-verb rejection row on read (wired registry)', async () => {
    // A legacy on-disk stream: a downloader-delivered import rejected as unusable, whose
    // `ReviewResolved` was persisted at schema v1 under the pre-rename verb. Booting the runtime
    // over it proves the store is wired with the populated upcaster registry, not an empty one.
    const directory = mkdtempSync(path.join(tmpdir(), 'importer-db-'));
    cleanups.push(() => rmSync(directory, { recursive: true, force: true }));
    const databaseFile = path.join(directory, 'events.db');

    const database = openEventDatabase(databaseFile);
    const insert = database.prepare(
      `INSERT INTO events (stream_id, version, type, schema_version, data, metadata)
       VALUES (?, ?, ?, 1, ?, ?)`,
    );
    const meta = JSON.stringify(appendMetadata('imp-legacy', fixedClock()));
    const legacyStream: Record<string, unknown>[] = [
      requested({ source: SOURCE }),
      proposed([candidate({ distance: asDistance(0.5) })]),
      MATCH_REVIEW,
      legacyRejectResolvedData(['corrupt rip']),
    ];
    for (const [version, event] of legacyStream.entries()) {
      insert.run('imp-legacy', version, event.type, JSON.stringify(event), meta);
    }
    database.close();

    const result = await createImporterRuntime(config({ databaseFile }), silentLogger(), {
      tagger: fakeTagger(),
      intake: { deleteRelease: () => okAsync<void>(undefined) },
    });
    const runtime = result._unsafeUnwrap();
    cleanups.push(() => runtime.stop());

    const view = runtime.facade.getImport({ id: 'imp-legacy' });
    expect(view.ok).toBe(true);
    if (!view.ok) return;
    const resolved = view.value.history.find((entry) => entry.kind === 'review-resolved');
    expect(resolved).toMatchObject({ resolution: 'reject-unusable-delivery' });
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

  /**
   * The two errnos the real probe reads as "the delivered files have not landed yet". Both are
   * held for redelivery — as opposed to a probe that FAULTS (the next test), which the consumer
   * must report differently so an operator can tell "still copying" from "the filesystem is sick".
   */
  const notThereYet = [
    {
      situation: 'the delivered directory does not exist yet (ENOENT)',
      relativePath: 'not-there-yet',
      stage: () => {},
    },
    {
      situation: 'a component of the delivered path is a file, not a directory (ENOTDIR)',
      relativePath: 'blocker/album',
      stage: (intakeRoot: string) => writeFileSync(path.join(intakeRoot, 'blocker'), ''),
    },
  ];

  it.each(notThereYet)(
    'holds delivery, reporting it as missing, when $situation (real filesystem probe)',
    async ({ relativePath, stage }) => {
      const directory = mkdtempSync(path.join(tmpdir(), 'intake-'));
      cleanups.push(() => rmSync(directory, { recursive: true, force: true }));
      stage(directory);
      const { logger, lines } = capturingLogger('warn');

      const result = await createImporterRuntime(config({ intakeRoot: directory }), logger, {
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
          location: `/staging/${relativePath}`,
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
      expect(subscription.isHalted).toBe(false);
      // The hold names the situation an operator would act on — the files have not landed.
      expect(lines.join('')).toContain(
        `IntakeDirectoryMissing: ${path.join(directory, relativePath)}`,
      );
    },
  );

  it('lets an in-flight acquisition drain finish before it closes the store', async () => {
    // Stopping the subscription clears its poll interval, which only cancels the NEXT cycle. This
    // is the one already draining: stop() must not close the database out from under it, or its
    // checkpoint save lands on a closed handle, is swallowed as a modeled failure, and everything
    // that cycle consumed is redelivered on the next boot. Only a durable read after the runtime
    // is down can show which happened, so the checkpoint is read back from the file.
    const directory = mkdtempSync(path.join(tmpdir(), 'runtime-'));
    cleanups.push(() => rmSync(directory, { recursive: true, force: true }));
    const file = path.join(directory, 'events.db');

    const result = await createImporterRuntime(config({ databaseFile: file }), silentLogger(), {
      tagger: fakeTagger(),
      intake: { deleteRelease: () => okAsync<void>(undefined) },
    });
    const runtime = result._unsafeUnwrap();

    // A batch that carries no event still advances the checkpoint past everything it scanned, so
    // this isolates the store write the shutdown races — no delivery, no handler, just the save.
    // The feed parks its first read, so a cycle is provably mid-drain when stop() is called.
    const gate = Promise.withResolvers<void>();
    let isFirstRead = true;
    const feed: SeamFeed = {
      read: async () => {
        if (isFirstRead) {
          isFirstRead = false;
          await gate.promise;
        }
        return ok({ events: [], scannedTo: SCANNED_TO });
      },
    };
    const subscription = runtime.connectAcquisitionFeed(feed, { sourceRoot: '/staging' });
    const draining = subscription.start();
    // Let start() get past its checkpoint load and into the gated read before stopping: the
    // barrier stop() waits on is the in-flight cycle, and until the cycle exists there is nothing
    // to wait for. (In production the composition root awaits start() before wiring shutdown.)
    await new Promise((resolve) => setImmediate(resolve));

    const stopping = runtime.stop();
    gate.resolve();
    await stopping;
    await draining;

    // Reopened after the runtime is down: the durable checkpoint records the drained position,
    // which is only possible if the save happened while the handle was still open.
    const reopened = openEventDatabase(file);
    cleanups.push(() => {
      reopened.close();
    });
    const checkpoint = await new SqliteCheckpointStore(reopened).load('seam:acquisitions');

    expect(checkpoint._unsafeUnwrap()).toBe(SCANNED_TO);
  });

  it('constructs the real bridge on the configured interpreter, surfacing its failure as a value', async () => {
    // `/bin/false` stands in for a broken interpreter: it runs and exits 1. The boot error must
    // carry what the bridge actually did — an operator's only clue is this detail, and a boot
    // that could not even spawn the configured binary is a different fault with a different fix.
    const result = await createImporterRuntime(
      config({ bridgePython: '/bin/false', bridgeTimeoutMs: 2000 }),
      silentLogger(),
    );
    expect(result.isErr()).toBe(true);
    const startupError = result._unsafeUnwrapErr();
    expect(startupError.kind).toBe('BeetsConfigUnusable');
    expect(startupError.detail).toContain('bridge exited 1');
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

      expect(reads).toHaveLength(readsAtStop);
    } finally {
      vi.useRealTimers();
    }
  });

  it('classifies a genuine probe fault as transient (not a missing directory) via the real probe', async () => {
    const directory = mkdtempSync(path.join(tmpdir(), 'intake-'));
    cleanups.push(() => rmSync(directory, { recursive: true, force: true }));
    const { logger, lines } = capturingLogger('warn');

    const result = await createImporterRuntime(config({ intakeRoot: directory }), logger, {
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
    // Reported as a probe FAULT, never as "not there yet": the two situations need different
    // operator responses (fix the filesystem vs. wait for the copy), so they hold under
    // different reasons.
    expect(lines.join('')).toContain('IntakeProbeFailed');
    expect(lines.join('')).not.toContain('IntakeDirectoryMissing');
  });

  it('routes a proposal weaker than the configured auto-apply threshold to human review', async () => {
    // 0.5 is well outside the configured 0.04 bound: a human must look at it.
    const runtime = await bootProposing(0.04, 0.5);

    const submitted = await runtime.facade.submitImport({ path: '/intake/album' }, STORY);
    expect(submitted.ok).toBe(true);
    if (!submitted.ok) return;

    await vi.waitFor(() => {
      expect(runtime.facade.listPendingReviews().reviews).toHaveLength(1);
    });
    expect(runtime.facade.getImport({ id: submitted.value.importId })).toMatchObject({
      ok: true,
      value: { status: 'awaiting-review' },
    });
  });

  it('auto-applies a proposal within the configured auto-apply threshold', async () => {
    // The same 0.5 proposal against a bound that admits it — so it is the CONFIGURED number, not
    // the distance alone, that decides review versus auto-apply.
    const runtime = await bootProposing(0.9, 0.5);

    const submitted = await runtime.facade.submitImport({ path: '/intake/album' }, STORY);
    expect(submitted.ok).toBe(true);
    if (!submitted.ok) return;

    await vi.waitFor(() => {
      expect(runtime.facade.getImport({ id: submitted.value.importId })).toMatchObject({
        ok: true,
        value: { status: 'applied', location: APPLIED_LOCATION },
      });
    });
    expect(runtime.facade.listPendingReviews().reviews).toHaveLength(0);
  });

  it('deletes a rejected release from the intake root through the real filesystem adapter', async () => {
    // No `intake` override: the production FilesystemIntake is the one under test, so a rejected
    // release must actually disappear from disk — the review queue owns intake hygiene (D5).
    const intakeRoot = mkdtempSync(path.join(tmpdir(), 'intake-'));
    cleanups.push(() => rmSync(intakeRoot, { recursive: true, force: true }));
    const releaseDirectory = path.join(intakeRoot, 'Artist - Album');
    mkdirSync(releaseDirectory);
    writeFileSync(path.join(releaseDirectory, '01.flac'), '');

    const result = await createImporterRuntime(config({ intakeRoot }), silentLogger(), {
      tagger: taggerProposing(0.5),
    });
    const runtime = result._unsafeUnwrap();
    cleanups.push(() => runtime.stop());

    const submitted = await runtime.facade.submitImport({ path: releaseDirectory }, STORY);
    expect(submitted.ok).toBe(true);
    if (!submitted.ok) return;
    await vi.waitFor(() => {
      expect(runtime.facade.listPendingReviews().reviews).toHaveLength(1);
    });

    const resolved = await runtime.facade.resolveReview(
      {
        id: submitted.value.importId,
        resolution: { verb: 'reject' },
      },
      STORY,
    );
    expect(resolved.ok).toBe(true);

    await vi.waitFor(() => {
      expect(existsSync(releaseDirectory)).toBe(false);
    });
  });
});
