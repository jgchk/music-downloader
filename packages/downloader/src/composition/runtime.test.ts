import { STORY, appendMetadata, testContext } from '../application/__fixtures__/correlation.js';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { ResultAsync, errAsync, okAsync, ok } from 'neverthrow';
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  SqliteCheckpointStore,
  SqliteEventStore,
  UpcasterRegistry,
  openEventDatabase,
} from '../adapters/index.js';
import { SqliteDeadLetterStore } from '../adapters/sqlite/dead-letters.js';
import type { EffectPorts } from '../application/download/interpreter.js';
import { FakeDeadLetterStore, silentLogger } from '../application/__fixtures__/fakes.js';
import { createLogger } from '../application/logging/logger.js';
import { infraError } from '../application/ports/errors.js';
import type { TransferObserverPort, TryResult } from '../application/ports/outbound-ports.js';
import {
  defaultPolicies,
  matchingCandidate,
  requestedHistory,
  sampleTarget,
} from '../domain/download/__fixtures__/download-fixtures.js';
import type { ProbedAudio } from '../domain/validation/validators.js';
import type { SeamEvent, SeamFeed } from '../application/events/catch-up-subscription.js';
import { createDownloaderRuntime } from './runtime.js';
import type { DownloaderRuntime } from './runtime.js';

/**
 * The runtime factory under test: the composed-process construction path (merge-modular-monolith
 * D8) — store, projections, reactor, seam surfaces — driven end to end with fake effect ports.
 * The composed product entry (packages/web) calls exactly this factory; these tests are its
 * wiring proof: an download submitted through the facade is fulfilled by the reactor, appears
 * on the outbound feed, fires the post-commit wakeup, and a verdict consumed from the importer's
 * feed revives it — all against a runtime built by the factory, not hand-wired.
 */

const FILES = [
  { path: 'staging/01.flac', name: '01.flac' },
  { path: 'staging/02.flac', name: '02.flac' },
];
const PROBES: Record<string, ProbedAudio> = {
  'staging/01.flac': { decodedCleanly: true, codec: 'flac', durationMs: 251_000 },
  'staging/02.flac': { decodedCleanly: true, codec: 'flac', durationMs: 264_000 },
};
const COMPLETED: TryResult = { kind: 'completed', files: FILES };

function fakePorts(observer: TransferObserverPort): EffectPorts {
  return {
    metadata: { resolve: () => okAsync({ kind: 'resolved', target: sampleTarget }) },
    search: { search: () => okAsync([matchingCandidate('seeder')]) },
    download: {
      // The supervisor shape: start answers promptly; progress and the outcome arrive through
      // the runtime's observer wiring on a later turn, exactly as the real watch delivers them.
      start: (id, candidate, _policy) => {
        // Deliver like the real watch: at-least-once, retrying until the consumer lands it (a
        // concurrency conflict with the reactor's own follow-on append is expected and benign).
        const deliver = async (): Promise<void> => {
          observer.progress(id, { percent: 100, bytesTransferred: 1, bytesTotal: 1 });
          // At-least-once like the real watch, but BOUNDED so a regression fails fast instead of
          // hanging the suite (the expected loser is one benign concurrency conflict).
          for (let attempt = 1; attempt <= 100; attempt += 1) {
            const delivered = await observer.outcome(
              id,
              candidate.identity,
              COMPLETED,
              testContext(),
            );
            if (delivered.isOk()) {
              observer.finished(id);
              return;
            }
            await new Promise((resolve) => setTimeout(resolve, 1));
          }
          throw new Error('fake supervisor could not deliver the outcome in 100 attempts');
        };
        queueMicrotask(() => void deliver());
        return okAsync({ kind: 'started' });
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

const SUBMIT = {
  request: {
    kind: 'musicbrainz',
    mbid: '11111111-1111-4111-8111-111111111111',
    targetType: 'album',
  },
};

/** The position the gated feed reports having scanned - the save the shutdown races. */
const SCANNED_TO = 7;

const cleanups: (() => void | Promise<void>)[] = [];
afterEach(async () => {
  for (const cleanup of cleanups) await cleanup();
  cleanups.length = 0;
});

/** Boot the factory and unwrap: these wiring specs assert the healthy path. */
async function bootDownloaderRuntime(
  ...factoryArguments: Parameters<typeof createDownloaderRuntime>
): Promise<DownloaderRuntime> {
  const booted = await createDownloaderRuntime(...factoryArguments);
  return booted._unsafeUnwrap();
}

async function testRuntime(databaseFile = ':memory:'): Promise<DownloaderRuntime> {
  const runtime = await bootDownloaderRuntime(
    {
      databaseFile,
      depositRoot: '/library',
      stagingRoot: '/staging',
      musicbrainz: {},
      slskd: {},
    },
    silentLogger(),
    { ports: fakePorts },
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

/** The instant the injected boot clock starts at; the test moves it to make a retry come due. */
const BOOT_INSTANT = '2026-07-22T12:00:00.000Z';

/**
 * Boot a runtime whose FIRST metadata resolution faults (a retryable infrastructure error) and
 * whose later ones answer "no confident match". The first dispatch therefore parks the stream for
 * a backed-off retry, and — since nothing further is appended — only the reactor's own fallback
 * poll can pick the retry up. `reactorTiming` is deliberately NOT overridden: the production
 * jitter source is part of what parking exercises.
 */
async function bootWithParkingFirstEffect(): Promise<{
  runtime: DownloaderRuntime;
  resolutions: () => number;
  setNow: (instant: Date) => void;
  errorLines: string[];
}> {
  let calls = 0;
  let now = new Date(BOOT_INSTANT);
  const errorLines: string[] = [];
  const logger = createLogger({
    level: 'error',
    destination: { write: (line: string) => void errorLines.push(line) },
  });
  const ports = (observer: TransferObserverPort): EffectPorts => ({
    ...fakePorts(observer),
    metadata: {
      resolve: () => {
        calls += 1;
        return calls === 1
          ? errAsync(infraError('musicbrainz.resolve', 'musicbrainz unreachable'))
          : okAsync({ kind: 'unresolved' as const });
      },
    },
  });
  const runtime = await bootDownloaderRuntime(
    {
      databaseFile: ':memory:',
      depositRoot: '/library',
      stagingRoot: '/staging',
      musicbrainz: {},
      slskd: {},
    },
    logger,
    { ports, clock: { now: () => now } },
  );
  return {
    runtime,
    resolutions: () => calls,
    setNow: (instant) => {
      now = instant;
    },
    errorLines,
  };
}

/** Advance fake time in `stepMs` slices until `isDone`, or give up after `slices` of them. */
async function advanceUntil(isDone: () => boolean, stepMs: number, slices = 30): Promise<void> {
  for (let slice = 0; slice < slices && !isDone(); slice += 1) {
    await vi.advanceTimersByTimeAsync(stepMs);
  }
}

describe('createDownloaderRuntime', () => {
  it('drives a submitted download to fulfilment and exposes it on the seam surfaces', async () => {
    const runtime = await testRuntime();
    const wokeUp = vi.fn();
    cleanups.push(runtime.wakeups.subscribe(wokeUp));

    const submitted = await runtime.facade.submitAcquisition(SUBMIT, STORY);
    expect(submitted.ok).toBe(true);
    if (!submitted.ok) return;
    const id = submitted.value.acquisitionId;

    await untilFulfilled(runtime, id);
    expect(wokeUp).toHaveBeenCalled();

    // The settled watch retired its live progress: a fulfilled download reports none. The
    // observer→read-model flow-through itself is pinned mid-flight by its own test below.
    const progress = runtime.facade.getAcquisitionProgress({ id });
    expect(progress.ok).toBe(false);

    // The fulfilment is published on the outbound feed with its self-contained payload.
    const batch = await runtime.feed.read(0, 100);
    expect(batch.isOk()).toBe(true);
    const events = batch._unsafeUnwrap().events;
    expect(events.map((event) => event.type)).toContain('acquisition.fulfilled');
  });

  it('feeds live progress through the observer wiring into the read model, then retires it', async () => {
    // The delivery is gated so the download stays in flight while the test reads progress —
    // pinning observer.progress → read model (an assertion the post-settle read cannot make).
    const { promise: gate, resolve: release } = Promise.withResolvers<void>();
    const ports = (observer: TransferObserverPort): EffectPorts => ({
      ...fakePorts(observer),
      download: {
        start: (id, candidate) => {
          const deliver = async (): Promise<void> => {
            observer.progress(id, { percent: 42, bytesTransferred: 42, bytesTotal: 100 });
            await gate;
            for (let attempt = 1; attempt <= 100; attempt += 1) {
              const delivered = await observer.outcome(
                id,
                candidate.identity,
                COMPLETED,
                testContext(),
              );
              if (delivered.isOk()) {
                observer.finished(id);
                return;
              }
              await new Promise((resolve) => setTimeout(resolve, 1));
            }
            throw new Error('fake supervisor could not deliver the outcome in 100 attempts');
          };
          queueMicrotask(() => void deliver());
          return okAsync({ kind: 'started' });
        },
        abort: () => okAsync([]),
      },
    });
    const runtime = await bootDownloaderRuntime(
      {
        databaseFile: ':memory:',
        depositRoot: '/library',
        stagingRoot: '/staging',
        musicbrainz: {},
        slskd: {},
      },
      silentLogger(),
      { ports },
    );
    cleanups.push(() => runtime.stop());

    const submitted = await runtime.facade.submitAcquisition(SUBMIT, STORY);
    if (!submitted.ok) throw new Error('submit failed');
    const id = submitted.value.acquisitionId;

    await vi.waitFor(() => {
      const progress = runtime.facade.getAcquisitionProgress({ id });
      if (!progress.ok) throw new Error('no progress yet');
      expect(progress.value.percent).toBe(42);
    });

    release();
    await untilFulfilled(runtime, id);
    expect(runtime.facade.getAcquisitionProgress({ id }).ok).toBe(false); // retired on finish
  });

  it('boots the real adapter wiring and stops cleanly (no overrides)', async () => {
    // No acquisitions are submitted, so nothing dispatches — this pins real-adapter construction
    // and executes the stop seam (`slskdDownload.stop()` before the store closes); the latch
    // BEHAVIOR itself is owned by the adapter tier's "stop() latches every watch" test.
    const runtime = await bootDownloaderRuntime(
      {
        databaseFile: ':memory:',
        depositRoot: '/library',
        stagingRoot: '/staging',
        musicbrainz: {},
        slskd: {},
      },
      silentLogger(),
    );
    expect(runtime.readiness()).toEqual({ status: 'up' });
    await runtime.stop();
  });

  it('consumes importer verdicts over the connected feed and revives the download', async () => {
    const runtime = await testRuntime();
    const submitted = await runtime.facade.submitAcquisition(SUBMIT, STORY);
    if (!submitted.ok) throw new Error('submit failed');
    const id = submitted.value.acquisitionId;
    await untilFulfilled(runtime, id);

    const readResult = await runtime.feed.read(0, 100);
    const fulfilled = readResult._unsafeUnwrap().events.at(-1)!;
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
    const subscription = runtime.connectVerdictFeed(feed, { subscribe: () => () => {} });
    await subscription.start();
    cleanups.push(() => subscription.stop());

    await vi.waitFor(() => {
      const status = runtime.facade.getAcquisition({ id });
      if (!status.ok) throw new Error('missing');
      expect(status.value.status).not.toBe('Fulfilled');
    });
  });

  it('announces a verdict envelope the consumer cannot read, and still applies the verdict', async () => {
    // The consumer owns no logger — the runtime hands it the one channel it needs, for the one
    // thing it can silently get wrong: a producer whose correlation envelope has drifted out of
    // this reader's reach. Unannounced, the symptom (cross-context traces that stop joining at the
    // seam) is indistinguishable from a producer that predates the capability, which is silent and
    // permanent. The work proceeds either way: correlation may degrade the trace, never the verdict.
    const warnLines: string[] = [];
    const runtime = await bootDownloaderRuntime(
      {
        databaseFile: ':memory:',
        depositRoot: '/library',
        stagingRoot: '/staging',
        musicbrainz: {},
        slskd: {},
      },
      createLogger({
        level: 'warn',
        destination: { write: (line: string) => void warnLines.push(line) },
      }),
      { ports: fakePorts },
    );
    cleanups.push(() => runtime.stop());
    const submitted = await runtime.facade.submitAcquisition(SUBMIT, STORY);
    if (!submitted.ok) throw new Error('submit failed');
    const id = submitted.value.acquisitionId;
    await untilFulfilled(runtime, id);

    const readResult = await runtime.feed.read(0, 100);
    const fulfilled = readResult._unsafeUnwrap().events.at(-1)!;
    const verdict: SeamEvent = {
      globalSeq: 1,
      type: 'release.verdict',
      timestamp: '2026-07-03T12:00:00.000Z',
      data: {
        acquisitionId: id,
        candidate: (fulfilled.data as { candidate: unknown }).candidate,
        verdict: 'rejected',
        reasons: ['wrong pressing'],
      },
      // A live producer's envelope, in a shape this reader's schema rejects.
      metadata: { correlationId: 'not-a-trace-id' },
    };
    const feed: SeamFeed = {
      read: (from) =>
        Promise.resolve(ok({ events: from < 1 ? [verdict] : [], scannedTo: Math.max(from, 1) })),
    };
    const subscription = runtime.connectVerdictFeed(feed, { subscribe: () => () => {} });
    await subscription.start();
    cleanups.push(() => subscription.stop());

    await vi.waitFor(() => {
      const status = runtime.facade.getAcquisition({ id });
      if (!status.ok) throw new Error('missing');
      expect(status.value.status).not.toBe('Fulfilled');
    });
    const announced = warnLines
      .map((line) => JSON.parse(line) as { msg: string })
      .find((line) => line.msg.includes('correlation envelope this consumer cannot read'));
    expect(announced).toBeDefined();
  });

  it('mints the story, in the format every reader checks against, when the caller supplies an unusable one', async () => {
    // The runtime's correlation source is the ONE place this module's story format is established
    // (32 lowercase hex — a W3C trace id, so a later OpenTelemetry adoption carries this exact
    // value). A caller with no usable story gets one minted here, and it has to be a story every
    // downstream reader accepts: the seam's published envelope DROPS an id that fails the pattern
    // and the reactor treats one as a broken writer, so a mint in some other shape would detach
    // every trace it starts while the work itself went on looking healthy.
    const directory = mkdtempSync(path.join(tmpdir(), 'runtime-'));
    cleanups.push(() => rmSync(directory, { recursive: true, force: true }));
    const file = path.join(directory, 'events.db');
    const runtime = await bootDownloaderRuntime(
      {
        databaseFile: file,
        depositRoot: '/library',
        stagingRoot: '/staging',
        musicbrainz: {},
        slskd: {},
      },
      silentLogger(),
      { ports: fakePorts },
    );
    let isStopped = false;
    const stopOnce = async () => {
      if (isStopped) return;
      isStopped = true;
      await runtime.stop();
    };
    cleanups.push(stopOnce);

    const submitted = await runtime.facade.submitAcquisition(SUBMIT, 'not-a-trace-id');
    if (!submitted.ok) throw new Error('submit failed');
    await untilFulfilled(runtime, submitted.value.acquisitionId);
    await stopOnce(); // the store is this runtime's; read it back only once it has let go

    const reopened = openEventDatabase(file);
    const row = reopened
      .prepare(`SELECT metadata FROM events WHERE stream_id = ? AND version = 0`)
      .get(submitted.value.acquisitionId) as { metadata: string };
    reopened.close();
    const { correlationId } = JSON.parse(row.metadata) as { correlationId?: string };
    // Hardcoded, not the production constant: this scenario's whole claim is that THIS composition
    // root establishes the format, so importing the regex it is meant to pin would make the test
    // agree with any edit to it. 32 lowercase hex — a W3C trace id.
    expect(correlationId).toMatch(/^[0-9a-f]{32}$/);
  });

  it('stops the connected verdict subscription on stop() so its poll loop cannot outlive the db', async () => {
    vi.useFakeTimers();
    try {
      const runtime = await bootDownloaderRuntime(
        {
          databaseFile: ':memory:',
          depositRoot: '/library',
          stagingRoot: '/staging',
          musicbrainz: {},
          slskd: {},
        },
        silentLogger(),
        { ports: fakePorts },
      );
      let isStopped = false;
      const stopOnce = async () => {
        if (isStopped) {
          return;
        }

        isStopped = true;
        await runtime.stop();
      };
      cleanups.push(stopOnce);

      const reads: number[] = [];
      const feed: SeamFeed = {
        read: (from) => {
          reads.push(from);
          return Promise.resolve(ok({ events: [], scannedTo: from }));
        },
      };
      const subscription = runtime.connectVerdictFeed(feed, { subscribe: () => () => {} });
      await subscription.start();
      const readsAtStop = reads.length;

      await stopOnce(); // must stop the subscription's poll interval BEFORE closing the db
      await vi.advanceTimersByTimeAsync(30_000); // several 5s poll intervals

      // No further feed polls fired after stop: the interval was cleared, so nothing reads the
      // feed (or saves checkpoints) against the now-closed handle.
      expect(reads).toHaveLength(readsAtStop);
    } finally {
      vi.useRealTimers();
    }
  });

  it('lets an in-flight verdict drain finish before it closes the store', async () => {
    // Clearing the poll interval (the scenario above) only cancels the NEXT cycle. This is the
    // one already draining: stop() must not close the database out from under it, or its
    // checkpoint save lands on a closed handle, is swallowed as a modeled failure, and the
    // verdict it had already applied is redelivered on the next boot. Only a durable read after
    // the runtime is down can show which happened, so the checkpoint is read back from the file.
    const directory = mkdtempSync(path.join(tmpdir(), 'runtime-'));
    cleanups.push(() => rmSync(directory, { recursive: true, force: true }));
    const file = path.join(directory, 'events.db');

    const runtime = await testRuntime(file);

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
    const subscription = runtime.connectVerdictFeed(feed, { subscribe: () => () => {} });
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
    const checkpoint = await new SqliteCheckpointStore(reopened).load('seam:verdicts');

    expect(checkpoint._unsafeUnwrap()).toBe(SCANNED_TO);
  });

  it('rebuilds projections from the stored backlog on a fresh boot over the same file', async () => {
    const directory = mkdtempSync(path.join(tmpdir(), 'runtime-'));
    cleanups.push(() => rmSync(directory, { recursive: true, force: true }));
    const file = path.join(directory, 'events.db');

    const first = await testRuntime(file);
    const submitted = await first.facade.submitAcquisition(SUBMIT, STORY);
    if (!submitted.ok) throw new Error('submit failed');
    await untilFulfilled(first, submitted.value.acquisitionId);
    await first.stop();

    const second = await testRuntime(file);
    const listed = second.facade.listAcquisitions().acquisitions;
    expect(listed.map((entry) => entry.acquisitionId)).toContain(submitted.value.acquisitionId);
  });

  it('serves a legacy v1 row upcast through the composed runtime path', async () => {
    // The regression this pins: composition (or the store default) silently dropping the populated
    // upcaster registry would serve raw v1 payloads at 100% unit coverage — only a boot over a
    // legacy file proves the composed read path lifts them.
    const directory = mkdtempSync(path.join(tmpdir(), 'runtime-'));
    cleanups.push(() => rmSync(directory, { recursive: true, force: true }));
    const file = path.join(directory, 'events.db');

    const seeded = openEventDatabase(file);
    const insert = seeded.prepare(
      `INSERT INTO events (stream_id, version, type, schema_version, data, metadata)
       VALUES (?, ?, ?, ?, ?, ?)`,
    );
    insert.run(
      'acq-legacy',
      0,
      'DownloadRequested',
      1,
      JSON.stringify({
        type: 'DownloadRequested',
        request: SUBMIT.request,
        policies: defaultPolicies(),
      }),
      JSON.stringify(appendMetadata('acq-legacy', 't')),
    );
    // A v1 ManualSelectionRequested: the unknown track count stored as the sentinel 0, which the
    // registered upcaster folds to absent before evolve ever sees it.
    insert.run(
      'acq-legacy',
      1,
      'ManualSelectionRequested',
      1,
      JSON.stringify({
        type: 'ManualSelectionRequested',
        candidates: [{ releaseMbid: 'r-1', title: 'Unknown Edition', trackCount: 0 }],
      }),
      JSON.stringify(appendMetadata('acq-legacy', 't')),
    );
    seeded.close();

    const runtime = await testRuntime(file);
    const status = runtime.facade.getAcquisition({ id: 'acq-legacy' });
    if (!status.ok) throw new Error('legacy download not served');
    expect(status.value.status).toBe('AwaitingManualSelection');
    expect(status.value.candidates).toEqual([{ releaseMbid: 'r-1', title: 'Unknown Edition' }]);
  });

  it('constructs real adapters when no overrides are given', async () => {
    const directory = mkdtempSync(path.join(tmpdir(), 'runtime-'));
    cleanups.push(() => rmSync(directory, { recursive: true, force: true }));
    const runtime = await bootDownloaderRuntime(
      {
        databaseFile: path.join(directory, 'data', 'events.db'),
        depositRoot: path.join(directory, 'library'),
        stagingRoot: path.join(directory, 'staging'),
        musicbrainz: {},
        slskd: {},
      },
      silentLogger(),
    );
    cleanups.push(() => runtime.stop());
    expect(runtime.facade.listAcquisitions()).toEqual({ acquisitions: [] });
  });

  it('reports readiness up on a freshly booted runtime (value, no throw)', async () => {
    const runtime = await testRuntime();
    expect(runtime.readiness()).toEqual({ status: 'up' });
  });

  it('reports readiness down once the verdict subscription halts on a poison event', async () => {
    const runtime = await testRuntime();
    // A known-type event with a malformed payload is a producer contract defect the verdict
    // consumer poisons; the `halt` policy stops the subscription without advancing.
    const poison: SeamEvent = {
      globalSeq: 1,
      type: 'release.verdict',
      timestamp: '2026-07-03T12:00:00.000Z',
      data: { not: 'a valid verdict' },
    };
    const feed: SeamFeed = {
      read: (from) =>
        Promise.resolve(ok({ events: from < 1 ? [poison] : [], scannedTo: Math.max(from, 1) })),
    };
    const subscription = runtime.connectVerdictFeed(feed, { subscribe: () => () => {} });
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
    expect(runtime.facade.listAcquisitions()).toEqual({ acquisitions: [] });
  });

  it('holds a parked effect until its backoff comes due, however often the poll fires', async () => {
    // The failed effect is parked with a jittered backoff, and the wall clock — not the poll
    // cadence — says when it may run again. A poll that re-dispatched on sight would hammer an
    // upstream that is already failing, at the poll's own frequency.
    vi.useFakeTimers();
    try {
      const { runtime, resolutions } = await bootWithParkingFirstEffect();
      cleanups.push(() => runtime.stop());

      const submitted = await runtime.facade.submitAcquisition(SUBMIT, STORY);
      if (!submitted.ok) throw new Error('submit failed');
      const id = submitted.value.acquisitionId;
      await advanceUntil(() => resolutions() === 1, 10);

      // Six poll intervals pass, but the clock the backoff is measured against does not move.
      await vi.advanceTimersByTimeAsync(30_000);

      expect(resolutions()).toBe(1);
      expect(runtime.facade.getAcquisition({ id })).toMatchObject({
        ok: true,
        value: { status: 'Pending' },
      });
    } finally {
      vi.useRealTimers();
    }
  });

  it('retries a parked effect from the reactor’s fallback poll once its backoff is due', async () => {
    // Nothing appends to the stream while the park waits, so the periodic poll composition wires
    // is the ONLY thing that can pick the retry up. Without it a single transient MusicBrainz
    // outage would strand the download until the next restart.
    vi.useFakeTimers();
    try {
      const { runtime, resolutions, setNow } = await bootWithParkingFirstEffect();
      cleanups.push(() => runtime.stop());

      const submitted = await runtime.facade.submitAcquisition(SUBMIT, STORY);
      if (!submitted.ok) throw new Error('submit failed');
      const id = submitted.value.acquisitionId;
      await advanceUntil(() => resolutions() === 1, 10);

      // Time passes beyond the backoff. No new event is appended and no wakeup fires.
      setNow(new Date(Date.parse(BOOT_INSTANT) + 20 * 60_000));
      await advanceUntil(() => resolutions() > 1, 1000);

      expect(runtime.facade.getAcquisition({ id })).toMatchObject({
        ok: true,
        value: { status: 'MetadataFailed' },
      });
    } finally {
      vi.useRealTimers();
    }
  });

  it('clears the reactor’s fallback poll on stop() so it cannot read the closed database', async () => {
    // The mirror of the retry above: once stop() has closed the store handle, the same periodic
    // poll must be detached. A surviving one re-enters the drain, reads a closed database and
    // logs a fault on every tick forever — while keeping the process's event loop alive.
    vi.useFakeTimers();
    try {
      const { runtime, resolutions, setNow, errorLines } = await bootWithParkingFirstEffect();

      const submitted = await runtime.facade.submitAcquisition(SUBMIT, STORY);
      if (!submitted.ok) throw new Error('submit failed');
      await advanceUntil(() => resolutions() === 1, 10);

      await runtime.stop();
      const errorsAtStop = errorLines.length;

      // The parked retry is now due — the very work a leaked poll would pick up.
      setNow(new Date(Date.parse(BOOT_INSTANT) + 20 * 60_000));
      await vi.advanceTimersByTimeAsync(30_000); // several 5s poll intervals

      expect(errorLines).toHaveLength(errorsAtStop);
      expect(resolutions()).toBe(1);
    } finally {
      vi.useRealTimers();
    }
  });
});

describe('stalled exposure at boot (reactor-durability D2)', () => {
  /** The injected boot clock's fixed instant; prune horizons are computed from it. */
  const BOOT_INSTANT = '2026-07-22T12:00:00.000Z';

  async function seededRuntime(occurredAt: string): Promise<DownloaderRuntime> {
    const directory = mkdtempSync(path.join(tmpdir(), 'runtime-'));
    cleanups.push(() => rmSync(directory, { recursive: true, force: true }));
    const file = path.join(directory, 'events.db');
    const database = openEventDatabase(file);
    const store = new SqliteEventStore(database, new UpcasterRegistry());
    const appendResult = await store.append(
      'acq-stalled',
      0,
      requestedHistory(),
      appendMetadata('acq-stalled', 't'),
    );
    appendResult._unsafeUnwrap();
    // The reactor already processed the event and dead-lettered its effect before the restart.
    await new SqliteCheckpointStore(database).save('acquisition-reactor', 1);
    const seedLetters = new SqliteDeadLetterStore(database);
    await seedLetters.record({
      subscription: 'acquisition-reactor',
      globalSeq: 1,
      streamId: 'acq-stalled',
      error: '{"effect":"Cleanup"}',
      occurredAt,
    });
    // A legacy letter with no stream attribution seeds nothing (tolerated, not fatal).
    await seedLetters.record({
      subscription: 'acquisition-reactor',
      globalSeq: 2,
      error: 'legacy',
      occurredAt,
    });
    database.close();

    const runtime = await bootDownloaderRuntime(
      {
        databaseFile: file,
        depositRoot: '/library',
        stagingRoot: '/staging',
        musicbrainz: {},
        slskd: {},
        reactor: { retry: { budgetMs: 21_600_000 }, stalledRetentionMs: 30 * 24 * 3_600_000 },
      },
      silentLogger(),
      {
        ports: fakePorts,
        // The prune horizon derives from this injected clock, so both prune cases below are
        // exact date arithmetic — never a race against the wall clock (S3 review sweep). The
        // instant re-drive timing lets the post-prune test await the backgrounded pass
        // deterministically instead of production jitter under a wall-clock budget.
        clock: { now: () => new Date(BOOT_INSTANT) },
        reactorTiming: { sleep: () => Promise.resolve(), random: () => 1 },
      },
    );
    cleanups.push(() => runtime.stop());
    return runtime;
  }

  it('seeds the stalled read model from dead letters recorded before the restart', async () => {
    // 12 hours before the boot instant: squarely inside the 30-day retention.
    const runtime = await seededRuntime('2026-07-22T00:00:00.000Z');

    const status = runtime.facade.getAcquisition({ id: 'acq-stalled' });
    expect(status).toMatchObject({ ok: true, value: { stalled: true } });
  });

  it('logs and continues when the dead-letter store cannot be read at boot', async () => {
    const deadLetters = new FakeDeadLetterStore();
    deadLetters.failList = true;
    deadLetters.failPrune = true;
    const lines: string[] = [];
    const logger = createLogger({
      level: 'warn',
      destination: { write: (line: string) => void lines.push(line) },
    });
    const runtime = await bootDownloaderRuntime(
      {
        databaseFile: ':memory:',
        depositRoot: '/library',
        stagingRoot: '/staging',
        musicbrainz: {},
        slskd: {},
      },
      logger,
      { ports: fakePorts, deadLetters },
    );
    cleanups.push(() => runtime.stop());

    expect(lines.join('')).toContain('stalled retention prune failed');
    expect(lines.join('')).toContain('stalled read-model seed failed');
  });

  it('prunes dead letters older than the retention horizon at boot, unstalling the stream', async () => {
    const runtime = await seededRuntime('2020-01-01T00:00:00.000Z'); // far beyond 30 days

    const status = runtime.facade.getAcquisition({ id: 'acq-stalled' });
    expect(status.ok).toBe(true);
    // Absence, not falsiness: the wire flag is tag-or-omit (`stalled?: true`).
    expect(status.ok ? status.value.stalled : undefined).toBeUndefined();

    // No longer stalled, the download is fair game for the startup re-drive: the backgrounded
    // pass (instant deterministic timing, injected above) drives it to its outcome.
    await vi.waitFor(() => {
      expect(runtime.facade.getAcquisition({ id: 'acq-stalled' })).toMatchObject({
        ok: true,
        value: { status: 'Fulfilled' },
      });
    });
  });
});

describe('boot readiness (reactor-durability D4)', () => {
  it('returns ready without awaiting the backlog drain — a hanging effect cannot block boot', async () => {
    const directory = mkdtempSync(path.join(tmpdir(), 'runtime-'));
    cleanups.push(() => rmSync(directory, { recursive: true, force: true }));
    const file = path.join(directory, 'events.db');
    const database = openEventDatabase(file);
    const store = new SqliteEventStore(database, new UpcasterRegistry());
    const appendResult2 = await store.append(
      'acq-hung',
      0,
      requestedHistory(),
      appendMetadata('acq-hung', 't'),
    );
    appendResult2._unsafeUnwrap();
    database.close();

    let releaseResolution!: () => void;
    const gate = new Promise<{ kind: 'unresolved' }>((resolve) => {
      releaseResolution = () => {
        resolve({ kind: 'unresolved' });
      };
    });
    const ports = (observer: TransferObserverPort): EffectPorts => ({
      ...fakePorts(observer),
      metadata: { resolve: () => ResultAsync.fromSafePromise(gate) },
    });

    // The pending resolution hangs indefinitely; boot must return anyway (backgrounded drain).
    const runtime = await bootDownloaderRuntime(
      {
        databaseFile: file,
        depositRoot: '/library',
        stagingRoot: '/staging',
        musicbrainz: {},
        slskd: {},
      },
      silentLogger(),
      { ports },
    );
    cleanups.push(() => runtime.stop());
    expect(runtime.readiness()).toEqual({ status: 'up' });

    // The backlog still completes in the background once the effect resolves.
    releaseResolution();
    await vi.waitFor(() => {
      const status = runtime.facade.getAcquisition({ id: 'acq-hung' });
      expect(status).toMatchObject({ ok: true, value: { status: 'MetadataFailed' } });
    });
  });

  it('refuses to boot when the projection rebuild cannot read the backlog', async () => {
    const directory = mkdtempSync(path.join(tmpdir(), 'downloader-runtime-'));
    cleanups.push(() => rmSync(directory, { recursive: true, force: true }));
    const file = path.join(directory, 'events.db');
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
    const result = await createDownloaderRuntime(
      {
        databaseFile: file,
        depositRoot: '/library',
        stagingRoot: '/staging',
        musicbrainz: {},
        slskd: {},
      },
      logger,
      { ports: fakePorts },
    );

    // A half-rebuilt projection boots half-blind: every download list/detail answers "nothing
    // exists" while readiness still reads `up` — an infra fault masquerading as a business answer.
    // Mirror the importer's contract: never boot on a projection we could not fully rebuild.
    expect(result.isErr()).toBe(true);
    expect(result._unsafeUnwrapErr().kind).toBe('ProjectionRebuildFailed');
    expect(errors.join('')).toContain('projection rebuild failed');
  });
});
