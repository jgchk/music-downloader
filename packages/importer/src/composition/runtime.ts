import { mkdirSync } from 'node:fs';
import { stat } from 'node:fs/promises';
import path from 'node:path';
import { err, ok } from 'neverthrow';
import type { Result } from 'neverthrow';
import { BeetsBridge } from '../adapters/beets/bridge-adapter.js';
import { FilesystemIntake } from '../adapters/filesystem/intake.js';
import { InProcessEventBus } from '../adapters/sqlite/event-bus.js';
import { SqliteCheckpointStore, SqliteEventStore } from '../adapters/sqlite/event-store.js';
import { SqliteDeadLetterStore } from '../adapters/sqlite/dead-letters.js';
import { SqliteParkedEffectStore } from '../adapters/sqlite/parked-effects.js';
import { parseDistance } from '../domain/shared/distance.js';
import { openEventDatabase } from '../adapters/sqlite/schema.js';
import { buildUpcasterRegistry } from '../adapters/sqlite/upcaster.js';
import { interpretEffect } from '../application/import/interpreter.js';
import type { InterpreterDependencies } from '../application/import/interpreter.js';
import { REACTOR_CONSUMER, Reactor } from '../application/import/reactor.js';
import type { UseCaseDependencies } from '../application/import/use-cases.js';
import type { Logger } from '../application/logging/logger.js';
import type { Clock } from '../application/ports/system-ports.js';
import type { IntakePort, TaggerConfig, TaggerPort } from '../application/ports/outbound-ports.js';
import {
  ImportStatusProjection,
  StalledReadModel,
  seedStalledReadModel,
} from '../application/projections/read-models.js';
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
  /** How long dead-lettered (stalled) entries are retained before pruning at boot (default 30d). */
  readonly stalledRetentionMs?: number;
}

/** Dead-lettered (stalled) entries are pruned at boot once older than this (30 days). */
const DEFAULT_STALLED_RETENTION_MS = 30 * 24 * 60 * 60 * 1000;

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
  readonly beetsConfig: TaggerConfig;
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

export type ImporterStartupError =
  | { readonly kind: 'BeetsConfigUnusable'; readonly detail: string }
  | { readonly kind: 'ProjectionRebuildFailed'; readonly detail: string }
  | { readonly kind: 'InvalidAutoApplyThreshold'; readonly detail: string };

/** True only for the "the directory is not there (yet)" errnos — everything else is a real fault. */
function isDirectoryAbsent(error: unknown): boolean {
  const code = (error as NodeJS.ErrnoException | null)?.code;
  return code === 'ENOENT' || code === 'ENOTDIR';
}

async function realDirectoryExists(directory: string): Promise<boolean> {
  try {
    const statResult = await stat(directory);
    return statResult.isDirectory();
  } catch (error) {
    // Only "not there (yet)" is a plain `false` — the directory the delivered files will land in.
    // Any other errno (EACCES / EIO / ELOOP …) is a genuine infra fault, not a missing directory:
    // rethrow it so the consumer classifies it distinctly instead of looping forever as if absent.
    if (isDirectoryAbsent(error)) return false;
    throw error;
  }
}

export async function createImporterRuntime(
  config: ImporterRuntimeConfig,
  logger: Logger,
  overrides: ImporterRuntimeOverrides = {},
): Promise<Result<ImporterRuntime, ImporterStartupError>> {
  const clock = overrides.clock ?? { now: () => new Date() };

  // The configured auto-apply threshold crosses the edge here: parse it into a branded Distance so
  // the domain's `distance > threshold` routing can never turn on an out-of-range or NaN bound.
  const autoApplyThreshold = parseDistance(config.autoApplyThreshold);
  if (autoApplyThreshold.isErr()) {
    return err({
      kind: 'InvalidAutoApplyThreshold',
      detail: `autoApplyThreshold must be within [0, 1], got ${config.autoApplyThreshold}`,
    });
  }

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
    // Both an unusable config (ConfigInvalid) and a genuine validate fault (InfraError) fail the boot
    // loudly; only their rendered detail differs. Neither is retried — startup never limps on.
    const validateError = beetsConfig.error;
    const detail =
      validateError.kind === 'ConfigInvalid' ? validateError.detail : validateError.message;
    return err({ kind: 'BeetsConfigUnusable', detail });
  }
  logger.info(
    { beetsVersion: beetsConfig.value.beetsVersion, plugins: beetsConfig.value.plugins },
    'beets configuration validated',
  );

  mkdirSync(path.dirname(config.databaseFile), { recursive: true });
  const database = openEventDatabase(config.databaseFile);
  const bus = new InProcessEventBus(logger);
  const store = new SqliteEventStore(database, buildUpcasterRegistry(), bus);
  const checkpoints = new SqliteCheckpointStore(database);
  const deadLetters = new SqliteDeadLetterStore(database);
  const parkedEffects = new SqliteParkedEffectStore(database);

  // The stalled read model (reactor-durability parity): seed it from the dead-letter store at boot,
  // pruning aged letters first, so an import dead-lettered before a restart reads stalled again.
  const stalledModel = new StalledReadModel();
  const retentionMs = config.stalledRetentionMs ?? DEFAULT_STALLED_RETENTION_MS;
  const horizon = new Date(clock.now().getTime() - retentionMs).toISOString();
  await seedStalledReadModel(deadLetters, stalledModel, REACTOR_CONSUMER, horizon, logger);

  const status = new ImportStatusProjection();
  const backlog = await store.readAll(0);
  if (backlog.isErr()) {
    // A projection rebuilt from a partial read boots half-blind: the durable acquisition-idempotency
    // index is incomplete (redelivered fulfillments re-import already-imported releases) and every
    // query returns nothing while readiness still says `up`. Fail the boot loudly, exactly as an
    // unusable beets config does — never boot on a projection we could not fully rebuild.
    logger.error({ err: backlog.error }, 'projection rebuild failed; refusing to boot');
    database.close();
    return err({ kind: 'ProjectionRebuildFailed', detail: backlog.error.message });
  }
  status.rebuild(backlog.value);
  // This read-model projection is kept live only by the bus — no catch-up cursor; it is fully
  // rebuilt from `readAll(0)` above at every boot. Trade-off: the event bus wraps each handler in
  // its own try/catch, so if an `apply` here throws, the bus swallows and logs it and the in-memory
  // read model diverges from the log until the next restart (which rebuilds it). Acceptable because
  // it is a queryable projection, not a decision input, and the divergence self-heals on reboot.
  bus.subscribe((stored) => {
    status.apply(stored);
  });

  const intake =
    overrides.intake ?? new FilesystemIntake({ intakeRoot: config.intakeRoot }, logger);
  const interpreter: InterpreterDependencies = { store, clock, ports: { tagger, intake } };
  const reactor = new Reactor({
    store,
    checkpoints,
    bus,
    deadLetters,
    parked: parkedEffects,
    stalled: stalledModel,
    clock,
    logger,
    interpret: (importId, effect) => interpretEffect(interpreter, importId, effect),
  });
  await reactor.start();

  const dependencies: UseCaseDependencies = {
    store,
    clock,
    status,
    stalled: stalledModel,
    policy: { autoApplyThreshold: autoApplyThreshold.value },
  };
  const facade = createImporterFacade(dependencies);
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
        handler: intakeEventConsumer(dependencies, {
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
      // Stop the inbound acquisition subscription before closing the DB: its fallback poll would
      // otherwise keep firing `feed.read`/`store.readAll` against a closed handle (error loop that
      // also keeps the event loop alive).
      acquisitions?.stop();
      database.close();
      return Promise.resolve();
    },
  });
}
