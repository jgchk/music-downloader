import { randomUUID } from 'node:crypto';
import { mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import {
  FfmpegAudioProbe,
  FilesystemLibrary,
  InProcessEventBus,
  MusicBrainzMetadata,
  SlskdClient,
  SlskdDownload,
  SlskdResourceRemover,
  SlskdSearch,
  SqliteCheckpointStore,
  SqliteEventStore,
  SqliteResourceLedger,
  UpcasterRegistry,
  fetchHttpClient,
  openEventDatabase,
  realTimer,
} from '../adapters/index.js';
import { SqliteDeadLetterStore } from '../adapters/sqlite/dead-letters.js';
import { Reactor } from '../application/acquisition/reactor.js';
import { SourceResourceSweep } from '../application/acquisition/sweep.js';
import type { EffectPorts, InterpreterDeps } from '../application/acquisition/interpreter.js';
import type { UseCaseDeps } from '../application/acquisition/use-cases.js';
import type { Logger } from '../application/logging/logger.js';
import type { Clock, IdGenerator } from '../application/ports/system-ports.js';
import {
  AcquisitionStatusProjection,
  LibraryViewProjection,
  ProgressReadModel,
} from '../application/projections/read-models.js';
import { CatchUpSubscription } from '../application/events/catch-up-subscription.js';
import type { SeamFeed } from '../application/events/catch-up-subscription.js';
import { OutboundFeed } from '../application/events/outbound-feed.js';
import { publishedEventMapping } from '../interfaces/contracts/events/mapping.js';
import { verdictEventConsumer } from '../interfaces/events/verdict-consumer.js';
import { createDownloaderFacade } from '../facade/index.js';
import type { DownloaderFacade } from '../facade/index.js';

/**
 * The downloader module's runtime factory (merge-modular-monolith D8): everything the module runs
 * in a composed process — store, bus, projections, reactor, sweep — behind one constructor, with
 * the seam surfaces the product's composition root cross-connects: this module's outbound `feed`
 * and post-commit `wakeups`, and `connectVerdictFeed` for consuming the importer's verdicts. The
 * interfaces stay outside: callers get the `facade` and serve it however they like. Overrides are
 * the vanilla-DI test seams; production passes none.
 */

export interface DownloaderRuntimeConfig {
  readonly databaseFile: string;
  readonly libraryRoot: string;
  readonly stagingRoot: string;
  readonly musicbrainz: { readonly baseUrl?: string; readonly userAgent?: string };
  readonly slskd: { readonly baseUrl?: string; readonly apiKey?: string };
}

export interface DownloaderRuntimeOverrides {
  readonly ports?: EffectPorts;
  readonly clock?: Clock;
  readonly ids?: IdGenerator;
}

export interface SeamWakeups {
  subscribe(listener: () => void): () => void;
}

/**
 * This module's own readiness shape (design D4) — declared locally, no shared kernel: `up` unless
 * the inbound verdict subscription has halted on a poison event. A synchronous read of in-memory
 * runtime state; never a value that throws, never an event-store scan.
 */
export interface DownloaderReadiness {
  readonly status: 'up' | 'down';
}

export interface DownloaderRuntime {
  readonly facade: DownloaderFacade;
  /** This module's outbound seam surface, consumed by the importer's subscription. */
  readonly feed: OutboundFeed;
  readonly wakeups: SeamWakeups;
  /** Build (unstarted) the subscription that consumes the importer's verdict feed. */
  connectVerdictFeed(feed: SeamFeed, wakeups?: SeamWakeups): CatchUpSubscription;
  /** Side-effect-free readiness snapshot from in-memory runtime state (design D4). */
  readiness(): DownloaderReadiness;
  stop(): Promise<void>;
}

export async function createDownloaderRuntime(
  config: DownloaderRuntimeConfig,
  logger: Logger,
  overrides: DownloaderRuntimeOverrides = {},
): Promise<DownloaderRuntime> {
  const clock = overrides.clock ?? { now: () => new Date() };
  const ids = overrides.ids ?? { next: () => randomUUID() };

  mkdirSync(dirname(config.databaseFile), { recursive: true });
  const db = openEventDatabase(config.databaseFile);
  const bus = new InProcessEventBus();
  const store = new SqliteEventStore(db, new UpcasterRegistry(), bus);
  const checkpoints = new SqliteCheckpointStore(db);
  const deadLetters = new SqliteDeadLetterStore(db);
  const ledger = new SqliteResourceLedger(db, clock);

  const status = new AcquisitionStatusProjection();
  const progressModel = new ProgressReadModel();
  const libraryView = new LibraryViewProjection();

  const backlog = await store.readAll(0);
  if (backlog.isOk()) {
    status.rebuild(backlog.value);
    for (const stored of backlog.value) libraryView.apply(stored);
  } else {
    logger.error({ err: backlog.error }, 'projection rebuild failed');
  }
  bus.subscribe((stored) => {
    status.apply(stored);
    libraryView.apply(stored);
  });

  const slskdClient = new SlskdClient(fetchHttpClient, {
    baseUrl: config.slskd.baseUrl,
    apiKey: config.slskd.apiKey,
  });
  const ports: EffectPorts = overrides.ports ?? {
    metadata: new MusicBrainzMetadata(logger, fetchHttpClient, {
      baseUrl: config.musicbrainz.baseUrl,
      userAgent: config.musicbrainz.userAgent,
    }),
    search: new SlskdSearch(logger, ledger, slskdClient, realTimer),
    download: new SlskdDownload(
      logger,
      ledger,
      { stagingRoot: config.stagingRoot },
      slskdClient,
      realTimer,
    ),
    probe: new FfmpegAudioProbe(logger),
    library: new FilesystemLibrary(
      { libraryRoot: config.libraryRoot, stagingRoot: config.stagingRoot },
      logger,
    ),
  };

  await new SourceResourceSweep({
    ledger,
    remover: new SlskdResourceRemover(logger, slskdClient),
    store,
    logger,
  }).run();

  const interpreter: InterpreterDeps = {
    store,
    clock,
    ports,
    onProgress: (acquisitionId, _candidate, progress) => {
      progressModel.update(acquisitionId, progress);
    },
  };
  const reactor = new Reactor({ store, checkpoints, bus, logger, interpreter });
  await reactor.start();

  const deps: UseCaseDeps = { store, clock, ids, status, progress: progressModel };
  const facade = createDownloaderFacade(deps);
  const feed = new OutboundFeed(store, publishedEventMapping);
  const wakeups: SeamWakeups = {
    subscribe: (listener) => bus.subscribe(() => listener()),
  };

  // The inbound seam subscription this runtime owns; the composition root connects it, and its
  // halted-on-poison state is this module's one exposed "down" signal (design D4).
  let verdicts: CatchUpSubscription | undefined;

  return {
    facade,
    feed,
    wakeups,
    connectVerdictFeed(verdictFeed, verdictWakeups) {
      verdicts = new CatchUpSubscription({
        name: 'seam:verdicts',
        feed: verdictFeed,
        checkpoints,
        deadLetters,
        handler: verdictEventConsumer(deps),
        policy: 'halt',
        logger,
        clock,
        retry: { attempts: 3, baseDelayMs: 250 },
        batchSize: 100,
        pollIntervalMs: 5000,
        sleep: (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
        wakeups: verdictWakeups,
      });
      return verdicts;
    },
    readiness() {
      return { status: verdicts?.isHalted ? 'down' : 'up' };
    },
    stop() {
      reactor.stop();
      db.close();
      return Promise.resolve();
    },
  };
}
