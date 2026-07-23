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
import { parseDistance } from '../domain/shared/distance.js';
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
    return (await stat(directory)).isDirectory();
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
  if (backlog.isErr()) {
    // A projection rebuilt from a partial read boots half-blind: the durable acquisition-idempotency
    // index is incomplete (redelivered fulfillments re-import already-imported releases) and every
    // query returns nothing while readiness still says `up`. Fail the boot loudly, exactly as an
    // unusable beets config does — never boot on a projection we could not fully rebuild.
    logger.error({ err: backlog.error }, 'projection rebuild failed; refusing to boot');
    db.close();
    return err({ kind: 'ProjectionRebuildFailed', detail: backlog.error.message });
  }
  status.rebuild(backlog.value);
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
    deadLetters,
    clock,
    logger,
    interpret: (importId, effect) => interpretEffect(interpreter, importId, effect),
  });
  await reactor.start();

  const deps: UseCaseDeps = {
    store,
    clock,
    status,
    policy: { autoApplyThreshold: autoApplyThreshold.value },
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
      // Stop the inbound acquisition subscription before closing the DB: its fallback poll would
      // otherwise keep firing `feed.read`/`store.readAll` against a closed handle (error loop that
      // also keeps the event loop alive).
      acquisitions?.stop();
      db.close();
      return Promise.resolve();
    },
  });
}
