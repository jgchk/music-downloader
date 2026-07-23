import { ok, okAsync } from 'neverthrow';
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  InProcessEventBus,
  SqliteCheckpointStore,
  SqliteEventStore,
  SqliteParkedEffectStore,
  UpcasterRegistry,
  openEventDatabase,
} from '../adapters/index.js';
import type {
  EffectPorts,
  InterpreterDependencies,
} from '../application/acquisition/interpreter.js';
import { Reactor } from '../application/acquisition/reactor.js';
import type { UseCaseDependencies } from '../application/acquisition/use-cases.js';
import { fixedClock, sequentialIds, silentLogger } from '../application/__fixtures__/fakes.js';
import type { DownloadResult, ImportResult } from '../application/ports/outbound-ports.js';
import {
  AcquisitionStatusProjection,
  LibraryViewProjection,
  ProgressReadModel,
  StalledReadModel,
} from '../application/projections/read-models.js';
import type { AcquisitionPhase } from '../domain/acquisition/acquisition.js';
import {
  matchingCandidate,
  sampleTarget,
} from '../domain/acquisition/__fixtures__/acquisition-fixtures.js';
import type { Candidate } from '../domain/candidate/candidate.js';
import type { ProbedAudio } from '../domain/validation/validators.js';
import { CatchUpSubscription } from '../application/events/catch-up-subscription.js';
import type { SeamEvent } from '../application/events/catch-up-subscription.js';
import { OutboundFeed } from '../application/events/outbound-feed.js';
import { SqliteDeadLetterStore } from '../adapters/sqlite/dead-letters.js';
import { publishedEventMapping } from '../interfaces/contracts/events/mapping.js';
import type { AcquisitionFulfilledEvent } from '../interfaces/contracts/events/schemas.js';
import { verdictEventConsumer } from '../interfaces/events/verdict-consumer.js';
import { createDownloaderFacade } from '../facade/index.js';

/**
 * The E2E tier (D4): the whole module wired for real — SQLite event store, in-process bus,
 * projections, the durable reactor — driven end to end through the wire-shaped facade (the
 * module's sole entry point since the interface consolidation) against fake outbound ports
 * (slskd / MusicBrainz / ffmpeg / library). It exercises the reactor cascade
 * (resolve → search → rank → download → validate → import) that the unit tiers only touch in
 * isolation, covering the happy path, retry-then-succeed, exhaustion, and an import conflict.
 */

const DOWNLOADED_FILES = [
  { path: 'staging/01.flac', name: '01.flac' },
  { path: 'staging/02.flac', name: '02.flac' },
];
const PROBES: Record<string, ProbedAudio> = {
  'staging/01.flac': { decodedCleanly: true, codec: 'flac', durationMs: 251_000 },
  'staging/02.flac': { decodedCleanly: true, codec: 'flac', durationMs: 264_000 },
};
const COMPLETED: DownloadResult = { kind: 'completed', files: DOWNLOADED_FILES };
const FAILED: DownloadResult = { kind: 'failed', reason: 'Stalled' };
/** Files the source had already completed into staging when a multi-file candidate was abandoned. */
const PARTIAL_FILES = [{ path: 'staging/partial-01.flac', name: '01.flac' }];
const ABANDONED: DownloadResult = { kind: 'failed', reason: 'Stalled', files: PARTIAL_FILES };
const IMPORTED: ImportResult = { kind: 'imported', location: '/library/Radiohead/Kid A (2000)' };
const CONFLICT: ImportResult = { kind: 'conflict', location: '/library/Radiohead/Kid A (2000)' };

const SUBMIT_BODY = {
  request: {
    kind: 'musicbrainz',
    mbid: '11111111-1111-4111-8111-111111111111',
    targetType: 'album',
  },
};

function candidateWithSpeed(username: string, speedBytesPerSec: number): Candidate {
  const base = matchingCandidate(username);
  return { ...base, source: { ...base.source, speedBytesPerSec } };
}

interface E2EOptions {
  searchByRound: (round: number) => readonly Candidate[];
  downloadByUser: Record<string, DownloadResult>;
  importResult: ImportResult;
}

function wire(options: E2EOptions) {
  const database = openEventDatabase(':memory:');
  const bus = new InProcessEventBus();
  const store = new SqliteEventStore(database, new UpcasterRegistry(), bus);
  const checkpoints = new SqliteCheckpointStore(database);
  const discardStaging = vi.fn((_files) => okAsync<void>(undefined));
  const status = new AcquisitionStatusProjection();
  const progressModel = new ProgressReadModel();
  const stalledModel = new StalledReadModel();
  const libraryView = new LibraryViewProjection();
  bus.subscribe((stored) => {
    status.apply(stored);
    libraryView.apply(stored);
  });

  const ports: EffectPorts = {
    metadata: { resolve: () => okAsync({ kind: 'resolved', target: sampleTarget }) },
    search: { search: (_acquisitionId, _target, round) => okAsync(options.searchByRound(round)) },
    download: {
      download: (_acquisitionId, candidate, _policy, onProgress) => {
        const result = options.downloadByUser[candidate.identity.username] ?? FAILED;
        if (result.kind === 'completed') {
          onProgress({ percent: 100, bytesTransferred: 1, bytesTotal: 1 });
        }
        return okAsync(result);
      },
      abort: () => okAsync([]),
    },
    probe: { probe: (path) => okAsync(PROBES[path]!) },
    library: { import: () => okAsync(options.importResult), discardStaging },
  };
  const interpreter: InterpreterDependencies = {
    store,
    clock: fixedClock(),
    ports,
    onProgress: (id, _candidate, progress) => progressModel.update(id, progress),
  };
  const reactor = new Reactor({
    store,
    checkpoints,
    bus,
    parked: new SqliteParkedEffectStore(database),
    deadLetters: new SqliteDeadLetterStore(database),
    stalled: stalledModel,
    logger: silentLogger(),
    interpreter,
    clock: fixedClock(),
    interval: (function_, ms) => {
      const handle = setInterval(function_, ms);
      return () => {
        clearInterval(handle);
      };
    },
    sleep: () => Promise.resolve(),
    random: () => 1,
  });
  const dependencies: UseCaseDependencies = {
    store,
    clock: fixedClock(),
    ids: sequentialIds(),
    status,
    progress: progressModel,
    stalled: stalledModel,
  };
  return {
    db: database,
    store,
    bus,
    checkpoints,
    reactor,
    status,
    progressModel,
    libraryView,
    deps: dependencies,
    discardStaging,
  };
}

type Wiring = ReturnType<typeof wire>;

const cleanups: (() => void | Promise<void>)[] = [];
afterEach(async () => {
  for (const cleanup of cleanups) await cleanup();
  cleanups.length = 0;
});

async function startApp(options: E2EOptions) {
  const w = wire(options);
  await w.reactor.start();
  const facade = createDownloaderFacade(w.deps);
  cleanups.push(
    () => w.reactor.stop(),
    () => {
      w.db.close();
    },
  );
  return { w, facade };
}

async function submit(facade: ReturnType<typeof createDownloaderFacade>): Promise<string> {
  const result = await facade.submitAcquisition(SUBMIT_BODY);
  expect(result.ok).toBe(true);
  if (!result.ok) throw new Error('unreachable');
  return result.value.acquisitionId;
}

async function settle(w: Wiring, id: string, phase: AcquisitionPhase): Promise<void> {
  await vi.waitFor(() => {
    expect(w.status.get(id)?.status).toBe(phase);
  });
}

const happyOptions: E2EOptions = {
  searchByRound: (round) => (round === 1 ? [candidateWithSpeed('a', 100)] : []),
  downloadByUser: { a: COMPLETED },
  importResult: IMPORTED,
};

describe('acquisition E2E', () => {
  it('fulfills an acquisition end to end through the facade', async () => {
    const { w, facade } = await startApp(happyOptions);

    const id = await submit(facade);
    await settle(w, id, 'Fulfilled');

    const status = facade.getAcquisition({ id });
    expect(status.ok && status.value.location).toBe(IMPORTED.location);

    const progress = facade.getAcquisitionProgress({ id });
    expect(progress.ok && progress.value.percent).toBe(100);
    expect(w.libraryView.list()).toHaveLength(1);
  });

  it('rejects a failed candidate and succeeds with the next best (retry-then-succeed)', async () => {
    const { w, facade } = await startApp({
      searchByRound: (round) =>
        round === 1 ? [candidateWithSpeed('a', 200), candidateWithSpeed('b', 100)] : [],
      downloadByUser: { a: FAILED, b: COMPLETED },
      importResult: IMPORTED,
    });

    const id = await submit(facade);
    await settle(w, id, 'Fulfilled');

    const view = w.status.get(id)!;
    expect(view.attempts).toBe(2);
    expect(view.rejectedCount).toBe(1);
    expect(view.history.some((entry) => entry.kind === 'download-failed')).toBe(true);
  });

  it('discards an abandoned candidate’s completed subset, keeping its failure reason', async () => {
    const { w, facade } = await startApp({
      searchByRound: (round) =>
        round === 1 ? [candidateWithSpeed('a', 200), candidateWithSpeed('b', 100)] : [],
      downloadByUser: { a: ABANDONED, b: COMPLETED },
      importResult: IMPORTED,
    });

    const id = await submit(facade);
    await settle(w, id, 'Fulfilled');

    // The abandoned candidate's already-completed files are discarded from staging — no residue —
    // via the same cleanup path a rejected candidate uses (D2).
    await vi.waitFor(() => {
      expect(w.discardStaging).toHaveBeenCalledWith(PARTIAL_FILES);
    });
    // The abandonment was still recorded as a failure with its reason, not swallowed.
    expect(w.status.get(id)!.history.some((entry) => entry.kind === 'download-failed')).toBe(true);
  });

  it('exhausts when every candidate fails and re-search finds nothing', async () => {
    const { w, facade } = await startApp({
      searchByRound: (round) => (round === 1 ? [candidateWithSpeed('a', 100)] : []),
      downloadByUser: { a: FAILED },
      importResult: IMPORTED,
    });

    const id = await submit(facade);

    await settle(w, id, 'Exhausted');
  });

  it('reports an import conflict as a terminal conflicted state', async () => {
    const { w, facade } = await startApp({ ...happyOptions, importResult: CONFLICT });

    const id = await submit(facade);

    await settle(w, id, 'Conflicted');
    // The conflicted candidate's staged files must not be left orphaned in staging.
    await vi.waitFor(() => {
      expect(w.discardStaging).toHaveBeenCalledWith(DOWNLOADED_FILES);
    });
  });

  it('exposes a fulfilled acquisition on the outbound feed — self-contained and stable across redelivery', async () => {
    const { w, facade } = await startApp(happyOptions);

    // A consuming module's subscription: checkpoint + dead letters in the CONSUMER's own store.
    const consumerDatabase = openEventDatabase(':memory:');
    const received: SeamEvent[] = [];
    const subscriptionOf = (database: typeof consumerDatabase) =>
      new CatchUpSubscription({
        name: 'seam:acquisitions',
        feed: new OutboundFeed(w.store, publishedEventMapping),
        checkpoints: new SqliteCheckpointStore(database),
        deadLetters: new SqliteDeadLetterStore(database),
        handler: (event) => {
          received.push(event);
          return Promise.resolve(ok(undefined));
        },
        policy: 'halt',
        logger: silentLogger(),
        clock: fixedClock(),
        retry: { attempts: 1, baseDelayMs: 0 },
        batchSize: 100,
        pollIntervalMs: 60_000,
        sleep: () => Promise.resolve(),
        wakeups: { subscribe: (listener) => w.bus.subscribe(() => listener()) },
        interval: () => () => {},
      });
    const subscription = subscriptionOf(consumerDatabase);
    await subscription.start();
    cleanups.push(() => subscription.stop());

    const id = await submit(facade);
    await settle(w, id, 'Fulfilled');
    await vi.waitFor(() => {
      expect(received).toHaveLength(1);
    });

    // The fat payload: everything a consumer needs to act, no callback required.
    const envelope = received[0]!;
    expect(envelope.type).toBe('acquisition.fulfilled');
    const data = envelope.data as AcquisitionFulfilledEvent['data'];
    expect(data.acquisitionId).toBe(id);
    expect(data.target).toMatchObject({ artist: 'Radiohead', title: 'Kid A' });
    expect(data.location).toBe(IMPORTED.location);
    expect(data.files.map((file) => file.name)).toEqual(['01.flac', '02.flac']);
    expect(data.files[0]!.path).toBe(`${IMPORTED.location}/01.flac`);

    // Simulated redelivery (crash before the consumer committed → fresh checkpoint store):
    // the same event arrives again with the same global position and an identical payload.
    const redelivered = subscriptionOf(openEventDatabase(':memory:'));
    await redelivered.start();
    redelivered.stop();
    expect(received).toHaveLength(2);
    expect(received[1]).toStrictEqual(envelope);
  });

  it('revives a fulfilled acquisition on a seam-delivered rejection and re-fulfils with the next candidate', async () => {
    // Two ranked candidates: 'a' wins the first pass; 'b' stays in the retained working set.
    const { w, facade } = await startApp({
      searchByRound: (round) =>
        round === 1 ? [candidateWithSpeed('a', 200), candidateWithSpeed('b', 100)] : [],
      downloadByUser: { a: COMPLETED, b: COMPLETED },
      importResult: IMPORTED,
    });

    const id = await submit(facade);
    await settle(w, id, 'Fulfilled');
    expect(w.status.get(id)!.attempts).toBe(1);

    // The importer module's outbound feed, seen structurally: one recorded release verdict.
    const fulfilledIdentity = matchingCandidate('a').identity;
    const verdictEvents: SeamEvent[] = [
      {
        globalSeq: 1,
        type: 'release.verdict',
        timestamp: fixedClock().now().toISOString(),
        data: {
          acquisitionId: id,
          candidate: fulfilledIdentity,
          verdict: 'rejected',
          reasons: ['corrupt stub'],
        },
      },
    ];
    const feed = {
      read: (from: number) => {
        const events = verdictEvents.filter((event) => event.globalSeq > from);
        const scannedTo = events.length > 0 ? events.at(-1)!.globalSeq : from;
        return Promise.resolve(ok({ events, scannedTo }));
      },
    };
    const subscription = new CatchUpSubscription({
      name: 'seam:verdicts',
      feed,
      checkpoints: w.checkpoints, // the downloader's OWN store holds this consumer's checkpoint
      deadLetters: new SqliteDeadLetterStore(w.db),
      handler: verdictEventConsumer(w.deps),
      policy: 'halt',
      logger: silentLogger(),
      clock: fixedClock(),
      retry: { attempts: 3, baseDelayMs: 0 },
      batchSize: 100,
      pollIntervalMs: 60_000,
      sleep: () => Promise.resolve(),
      interval: () => () => {},
    });
    await subscription.start();
    cleanups.push(() => subscription.stop());

    // The revival re-enters the existing ladder: candidate 'b' downloads and the acquisition
    // re-fulfils, spending a second attempt.
    await vi.waitFor(() => {
      const view = w.status.get(id)!;
      expect(view.status).toBe('Fulfilled');
      expect(view.attempts).toBe(2);
    });
    const view = w.status.get(id)!;
    expect(view.rejectedCount).toBe(1);
    expect(view.location).toBe(IMPORTED.location);
    expect(
      view.history.some(
        (entry) => entry.kind === 'fulfillment-rejected' && entry.reasons[0] === 'corrupt stub',
      ),
    ).toBe(true);
    const selections = view.history.filter((entry) => entry.kind === 'selected');
    expect(selections.at(-1)!.candidate.username).toBe('b');

    // Redelivery converges: reset the checkpoint and replay — the decider no-ops, nothing changes.
    const readAllResult = await w.store.readAll(0);
    const eventCount = readAllResult._unsafeUnwrap().length;
    await subscription.reset();
    await subscription.poll();
    // A late verdict naming the *first* candidate again is stale against the new fulfilment.
    verdictEvents.push({ ...verdictEvents[0]!, globalSeq: 2 });
    await subscription.poll();
    const readAllResult2 = await w.store.readAll(0);
    expect(readAllResult2._unsafeUnwrap()).toHaveLength(eventCount);
    expect(w.status.get(id)!.attempts).toBe(2);
  });
});
