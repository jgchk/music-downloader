import { mkdirSync } from 'node:fs';
import { stat } from 'node:fs/promises';
import { dirname } from 'node:path';
import { err, ok } from 'neverthrow';
import type { Result } from 'neverthrow';
import { BeetsBridge } from '../adapters/beets/bridge-adapter.js';
import { FilesystemIntake } from '../adapters/filesystem/intake.js';
import { InProcessEventBus } from '../adapters/sqlite/event-bus.js';
import { SqliteCheckpointStore, SqliteEventStore } from '../adapters/sqlite/event-store.js';
import { SqliteDeadLetterStore } from '../adapters/sqlite/dead-letters.js';
import { openEventDatabase } from '../adapters/sqlite/schema.js';
import { UpcasterRegistry } from '../adapters/sqlite/upcaster.js';
import { interpretEffect } from '../application/import/interpreter.js';
import type { InterpreterDeps } from '../application/import/interpreter.js';
import { Reactor } from '../application/import/reactor.js';
import type { UseCaseDeps } from '../application/import/use-cases.js';
import type { Logger } from '../application/logging/logger.js';
import type { Clock } from '../application/ports/system-ports.js';
import type {
  IntakePort,
  TaggerConfiguration,
  TaggerPort,
} from '../application/ports/outbound-ports.js';
import { ImportStatusProjection } from '../application/projections/read-models.js';
import { CatchUpSubscription } from '../application/events/catch-up-subscription.js';
import type { SeamFeed } from '../application/events/catch-up-subscription.js';
import { OutboundFeed } from '../application/events/outbound-feed.js';
import { publishedEventMapping } from '../interfaces/contracts/events/mapping.js';
import { intakeEventConsumer } from '../interfaces/events/intake-consumer.js';
import { createImporterFacade } from '../facade/index.js';
import type { ImporterFacade } from '../facade/index.js';

/**
 * The importer module's runtime factory (merge-modular-monolith D8): everything the module runs
 * in a composed process — store, bus, projection, reactor, the validated beets bridge — behind
 * one constructor, plus the seam surfaces the product's composition root cross-connects: this
 * module's outbound `feed`/`wakeups` (release verdicts) and `connectAcquisitionFeed` for
 * consuming the downloader's fulfillments. Startup fails as a value when the user's beets
 * configuration is unusable (fail loudly at boot, never at first import). Overrides are the
 * vanilla-DI test seams; production passes none.
 */

export interface ImporterRuntimeConfig {
  readonly databaseFile: string;
  readonly intakeRoot: string;
  readonly beetsConfigPath: string;
  readonly bridgePython: string;
  readonly bridgeTimeoutMs: number;
  /** Override for bundled deployments where the packaged default beside this module is wrong. */
  readonly bridgeScript?: string;
  readonly autoApplyThreshold: number;
}

export interface ImporterRuntimeOverrides {
  readonly tagger?: TaggerPort;
  readonly intake?: IntakePort;
  readonly clock?: Clock;
  readonly directoryExists?: (directory: string) => Promise<boolean>;
}

export interface SeamWakeups {
  subscribe(listener: () => void): () => void;
}

export interface AcquisitionFeedOptions {
  /** The downloader's namespace root its delivered locations fall under (D11 re-rooting). */
  readonly sourceRoot: string;
}

/**
 * This module's own readiness shape (design D4) — declared locally, no shared kernel: `up` unless
 * the inbound acquisition subscription has halted on a poison event. A synchronous read of
 * in-memory runtime state; never a value that throws, never an event-store scan.
 */
export interface ImporterReadiness {
  readonly status: 'up' | 'down';
}

export interface ImporterRuntime {
  readonly facade: ImporterFacade;
  readonly beetsConfig: TaggerConfiguration;
  /** This module's outbound seam surface (release verdicts), consumed by the downloader. */
  readonly feed: OutboundFeed;
  readonly wakeups: SeamWakeups;
  /** Build (unstarted) the subscription that consumes the downloader's fulfillment feed. */
  connectAcquisitionFeed(
    feed: SeamFeed,
    options: AcquisitionFeedOptions,
    wakeups?: SeamWakeups,
  ): CatchUpSubscription;
  /** Side-effect-free readiness snapshot from in-memory runtime state (design D4). */
  readiness(): ImporterReadiness;
  stop(): Promise<void>;
}

export type ImporterStartupError = {
  readonly kind: 'BeetsConfigUnusable';
  readonly detail: string;
};

async function realDirectoryExists(directory: string): Promise<boolean> {
  try {
    return (await stat(directory)).isDirectory();
  } catch {
    return false;
  }
}

export async function createImporterRuntime(
  config: ImporterRuntimeConfig,
  logger: Logger,
  overrides: ImporterRuntimeOverrides = {},
): Promise<Result<ImporterRuntime, ImporterStartupError>> {
  const clock = overrides.clock ?? { now: () => new Date() };

  const tagger =
    overrides.tagger ??
    new BeetsBridge(logger, {
      pythonBin: config.bridgePython,
      beetsConfigPath: config.beetsConfigPath,
      timeoutMs: config.bridgeTimeoutMs,
      bridgeScript: config.bridgeScript,
    });
  const beetsConfig = await tagger.validate();
  if (beetsConfig.isErr()) {
    return err({ kind: 'BeetsConfigUnusable', detail: beetsConfig.error.message });
  }
  logger.info(
    { beetsVersion: beetsConfig.value.beetsVersion, plugins: beetsConfig.value.plugins },
    'beets configuration validated',
  );

  mkdirSync(dirname(config.databaseFile), { recursive: true });
  const db = openEventDatabase(config.databaseFile);
  const bus = new InProcessEventBus();
  const store = new SqliteEventStore(db, new UpcasterRegistry(), bus);
  const checkpoints = new SqliteCheckpointStore(db);
  const deadLetters = new SqliteDeadLetterStore(db);

  const status = new ImportStatusProjection();
  const backlog = await store.readAll(0);
  if (backlog.isOk()) {
    status.rebuild(backlog.value);
  } else {
    logger.error({ err: backlog.error }, 'projection rebuild failed');
  }
  bus.subscribe((stored) => {
    status.apply(stored);
  });

  const intake =
    overrides.intake ?? new FilesystemIntake({ intakeRoot: config.intakeRoot }, logger);
  const interpreter: InterpreterDeps = { store, clock, ports: { tagger, intake } };
  const reactor = new Reactor({
    store,
    checkpoints,
    bus,
    logger,
    interpret: (importId, effect) => interpretEffect(interpreter, importId, effect),
  });
  await reactor.start();

  const deps: UseCaseDeps = {
    store,
    clock,
    status,
    policy: { autoApplyThreshold: config.autoApplyThreshold },
  };
  const facade = createImporterFacade(deps);
  const feed = new OutboundFeed(store, publishedEventMapping);
  const wakeups: SeamWakeups = {
    subscribe: (listener) => bus.subscribe(() => listener()),
  };

  // The inbound seam subscription this runtime owns; the composition root connects it, and its
  // halted-on-poison state is this module's one exposed "down" signal (design D4).
  let acquisitions: CatchUpSubscription | undefined;

  return ok({
    facade,
    beetsConfig: beetsConfig.value,
    feed,
    wakeups,
    connectAcquisitionFeed(acquisitionFeed, options, acquisitionWakeups) {
      acquisitions = new CatchUpSubscription({
        name: 'seam:acquisitions',
        feed: acquisitionFeed,
        checkpoints,
        deadLetters,
        handler: intakeEventConsumer(deps, {
          sourceRoot: options.sourceRoot,
          intakeRoot: config.intakeRoot,
          directoryExists: overrides.directoryExists ?? realDirectoryExists,
        }),
        policy: 'halt',
        logger,
        clock,
        retry: { attempts: 3, baseDelayMs: 250 },
        batchSize: 100,
        pollIntervalMs: 5000,
        sleep: (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
        wakeups: acquisitionWakeups,
      });
      return acquisitions;
    },
    readiness() {
      return { status: acquisitions?.isHalted ? 'down' : 'up' };
    },
    stop() {
      reactor.stop();
      db.close();
      return Promise.resolve();
    },
  });
}
