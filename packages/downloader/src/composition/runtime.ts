import { randomBytes, randomUUID } from 'node:crypto';
import { toCorrelationId } from '../application/correlation/correlation-id.js';
import { mkdirSync } from 'node:fs';
import path from 'node:path';
import { err, ok } from 'neverthrow';
import type { Result } from 'neverthrow';
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
  SqliteParkedEffectStore,
  SqliteResourceLedger,
  buildUpcasterRegistry,
  fetchHttpClient,
  nodeCommandRunner,
  openEventDatabase,
  realTimer,
} from '../adapters/index.js';
import { SqliteDeadLetterStore } from '../adapters/sqlite/dead-letters.js';
import type { DeadLetterStore } from '../application/ports/dead-letter-port.js';
import { Reactor } from '../application/download/reactor.js';
import { DEFAULT_RETRY_POLICY } from '../application/download/retry-policy.js';
import type { RetryPolicy } from '../application/download/retry-policy.js';
import { SourceResourceSweep } from '../application/download/sweep.js';
import type {
  EffectPorts,
  InterpreterDependencies,
} from '../application/download/interpreter.js';
import { deliverDownloadOutcome } from '../application/download/download-outcome-consumer.js';
import type { TransferObserverPort } from '../application/ports/outbound-ports.js';
import type { UseCaseDependencies } from '../application/download/use-cases.js';
import type { Logger } from '../application/logging/logger.js';
import type { Clock, CorrelationSource, IdGenerator } from '../application/ports/system-ports.js';
import {
  DownloadStatusProjection,
  LibraryViewProjection,
  ProgressReadModel,
  StalledReadModel,
  seedStalledReadModel,
} from '../application/projections/read-models.js';
import { REACTOR_CONSUMER } from '../application/download/reactor.js';
import { CatchUpSubscription } from '../application/events/catch-up-subscription.js';
import type { SeamFeed } from '../application/events/catch-up-subscription.js';
import { OutboundFeed } from '../application/events/outbound-feed.js';
import { publishedEventMapping } from '../interfaces/contracts/events/mapping.js';
import { verdictEventConsumer } from '../interfaces/events/verdict-consumer.js';
import { createDownloaderFacade } from '../facade/index.js';
import type { DownloaderFacade } from '../facade/index.js';

// The module's log-redaction defaults, exposed on the runtime surface: the composed process
// constructs the ONE pino root both runtimes share, so redaction must be composed there — a
// module-internal default the composition root cannot see would never apply to a shipped line.
export { DEFAULT_REDACT_PATHS } from '../application/logging/logger.js';

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
  readonly depositRoot: string;
  readonly stagingRoot: string;
  readonly musicbrainz: { readonly baseUrl?: string; readonly userAgent?: string };
  readonly slskd: { readonly baseUrl?: string; readonly apiKey?: string };
  /** Probe/decode kill budget (per file); unset falls back to the adapter's generous default. */
  readonly ffmpeg?: { readonly timeoutMs?: number };
  /** Parked-effect retry tuning (reactor-durability D2); defaults are production-sane. */
  readonly reactor?: {
    readonly retry?: Partial<RetryPolicy>;
    /** How long dead-lettered (stalled) entries are retained before pruning at boot. */
    readonly stalledRetentionMs?: number;
  };
}

export interface DownloaderRuntimeOverrides {
  /**
   * Test seam for the effect ports. A factory: fakes receive the runtime's download observer so a
   * fake download port can deliver asynchronous outcomes through the real consumer wiring, the
   * way the slskd supervisor does (nonblocking-download-observation D2).
   */
  readonly ports?: (observer: TransferObserverPort) => EffectPorts;
  readonly clock?: Clock;
  readonly ids?: IdGenerator;
  readonly correlation?: CorrelationSource;
  /** Test seam: swap the dead-letter store (e.g. to prove boot survives its faults). */
  readonly deadLetters?: DeadLetterStore;
  /**
   * Test seam for the reactor's timing sources (the re-drive jitter sleep and its random),
   * so composed-boot tests can await the startup re-drive deterministically instead of racing
   * the production jitter under a wall-clock budget.
   */
  readonly reactorTiming?: {
    readonly sleep?: (ms: number) => Promise<void>;
    readonly random?: () => number;
  };
}

export interface SeamWakeups {
  subscribe(listener: () => void): () => void;
}

/** Dead-lettered (stalled) entries are pruned at boot once older than this (30 days). */
const DEFAULT_STALLED_RETENTION_MS = 30 * 24 * 60 * 60 * 1000;

/**
 * The real `sleep` handed to the reactor and the inbound subscription. A named function, not an
 * inline arrow at each site, so that the "a delay is unobservable" waiver below can be attached to
 * the DELAY and to nothing else: written inline, one `disable next-line ArrowFunction` also covers
 * the `new Promise` executor, and an executor that never calls `resolve` wedges the caller forever
 * — the opposite of unobservable.
 */
// Stryker disable next-line BlockStatement: an emptied body resolves immediately instead of after
// `ms`, and every caller only `await`s the result — so the mutant changes elapsed wall-clock and
// nothing else: same attempts, same order, same checkpoint advances. Wall-clock is the one thing a
// behavioural assertion here may not pin (a faked timer would assert that a timer is used).
function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * This module's own readiness shape (design D4) — declared locally, no shared kernel: `up` unless
 * the inbound verdict subscription has halted on a poison event. A synchronous read of in-memory
 * runtime state; never a value that throws, never an event-store scan.
 */
export interface DownloaderReadiness {
  readonly status: 'up' | 'down';
}

/**
 * Startup failures are values (mirroring the importer's factory): a runtime that cannot fully
 * rebuild its projections must refuse to boot, not serve empty answers with readiness `up`.
 */
export interface DownloaderStartupError {
  readonly kind: 'ProjectionRebuildFailed';
  readonly detail: string;
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
): Promise<Result<DownloaderRuntime, DownloaderStartupError>> {
  const clock = overrides.clock ?? { now: () => new Date() };
  const ids = overrides.ids ?? { next: () => randomUUID() };
  // 32 lowercase hex = a W3C trace id, so a later OpenTelemetry adoption can carry this exact
  // value (see application/correlation/correlation-id.ts). This is the ONE place this module's
  // format is established; every lift downstream follows from the brand rather than from trust.
  const correlation: CorrelationSource = overrides.correlation ?? {
    mint: () => toCorrelationId(randomBytes(16).toString('hex')),
  };

  mkdirSync(path.dirname(config.databaseFile), { recursive: true });
  const database = openEventDatabase(config.databaseFile);
  const bus = new InProcessEventBus(logger);
  const store = new SqliteEventStore(database, buildUpcasterRegistry(), bus);
  const checkpoints = new SqliteCheckpointStore(database);
  const deadLetters = overrides.deadLetters ?? new SqliteDeadLetterStore(database);
  const parkedEffects = new SqliteParkedEffectStore(database);
  const ledger = new SqliteResourceLedger(database, clock);

  const status = new DownloadStatusProjection();
  const progressModel = new ProgressReadModel();
  const libraryView = new LibraryViewProjection();

  const stalledModel = new StalledReadModel();
  const retentionMs = config.reactor?.stalledRetentionMs ?? DEFAULT_STALLED_RETENTION_MS;
  const horizon = new Date(clock.now().getTime() - retentionMs).toISOString();
  await seedStalledReadModel(deadLetters, stalledModel, REACTOR_CONSUMER, horizon, logger);

  const backlog = await store.readAll(0);
  if (backlog.isErr()) {
    // A projection rebuilt from a failed read boots half-blind: every download list/detail
    // answers "nothing exists" and the library dedup view is empty, all while readiness still
    // reads `up` — an infra fault masquerading as a business answer. Fail the boot loudly,
    // exactly as the importer's factory does — never boot on a projection we could not fully
    // rebuild.
    logger.error({ err: backlog.error }, 'projection rebuild failed; refusing to boot');
    database.close();
    return err({ kind: 'ProjectionRebuildFailed', detail: backlog.error.message });
  }
  status.rebuild(backlog.value);
  for (const stored of backlog.value) libraryView.apply(stored);
  // These two read models are kept live by the bus alone: boot-rebuilt from `readAll(0)` above,
  // then followed forward here with NO catch-up cursor of their own. The event bus now isolates
  // each handler in its own try/catch, so a throw from an `apply` is swallowed and logged rather
  // than propagated — a deliberate trade of fault-isolation over live self-repair. The cost: that
  // one dropped event leaves the in-memory model diverged from the log until the next restart,
  // which rebuilds it from scratch. The error log is the signal; reboot is the repair.
  bus.subscribe((stored) => {
    status.apply(stored);
    libraryView.apply(stored);
  });

  // Stryker disable next-line ObjectLiteral: dropping the configured slskd base URL and API key
  // changes only the HTTP request the client would send, and no in-process test can observe that:
  // `fetchHttpClient` is a module singleton imported here, not an injected seam, so there is no
  // point at which a test can see what composition handed the client. (That the client SENDS the
  // configured baseUrl/apiKey is pinned in the adapter tier against a fake HttpClient; only the
  // out-of-process E2E tier talks to a live slskd, and it is outside the mutation suite.)
  const slskdClient = new SlskdClient(fetchHttpClient, {
    baseUrl: config.slskd.baseUrl,
    apiKey: config.slskd.apiKey,
  });
  // The download observer: the supervisor's asynchronous reports re-entering the core — progress
  // into the ephemeral read model, outcomes through the download-outcome consumer (the appended
  // events publish on the bus, waking the reactor), and watch-end retiring live progress.
  const downloadObserver: TransferObserverPort = {
    progress: (acquisitionId, progress) => {
      progressModel.update(acquisitionId, progress);
    },
    outcome: (acquisitionId, candidate, result, context) =>
      // `context` is the supervisor's PINNED watch context, so the settled outcome re-enters the
      // core on the story that started the download rather than opening a new one.
      deliverDownloadOutcome({ store, clock, logger }, acquisitionId, candidate, result, context),
    finished: (acquisitionId) => {
      progressModel.clear(acquisitionId);
    },
  };
  // Held concretely (not via the port) so stop() can latch its watches — the shutdown seam only
  // composition needs; fake ports have no floating watches to latch. Built in one branch with
  // the default ports so "the supervisor exists exactly when the real adapter is in play" is
  // structural, not an assertion.
  let slskdDownload: SlskdDownload | undefined;
  let ports: EffectPorts;
  // The block below is the module's production adapter set, and the `ports` override is
  // ALL-OR-NOTHING: a test either supplies every port as a fake or gets every one of these. So no
  // in-process test can drive an effect through ONE real adapter, and every mutant inside this
  // block is unobservable in the mutation suite — the two no-override boot tests construct these
  // adapters and stop without dispatching anything, because dispatching would mean a real slskd
  // search, a real MusicBrainz request and a real ffmpeg spawn. Each site is suppressed with what
  // its mutant drops; the effect-level behaviour of each adapter is owned by the adapter tier.
  //
  // BE HONEST ABOUT WHAT THESE WAIVERS ARE. Everywhere else in this repo a `Stryker disable` argues
  // the mutant is EQUIVALENT — no observable difference, so no test could ever catch it. These do
  // not, and cannot: they argue only that the mutant is UNOBSERVABLE FROM AN IN-PROCESS TEST, which
  // is an assurance gap wearing a waiver's clothes. The sharpest one is the library/staging root
  // pair handed to `FilesystemLibrary` below — transpose them and finished releases are imported
  // into the staging root, with nothing in any tier failing. Recorded as named debt in
  // `openspec/changes/mutation-gate/design.md`, not only here, because a comment inside a waived
  // block is precisely where nobody looks once the gate is green.
  // Stryker disable next-line BlockStatement: drops the whole production adapter set (see above);
  // with fakes injected this branch never runs, and without them nothing dispatches.
  if (overrides.ports === undefined) {
    slskdDownload = new SlskdDownload(
      logger,
      ledger,
      // Stryker disable next-line ObjectLiteral: drops the staging root the supervisor writes
      // transfers into — observable only in a real slskd transfer, never in process.
      { stagingRoot: config.stagingRoot },
      downloadObserver,
      slskdClient,
      realTimer,
    );
    // Stryker disable next-line ObjectLiteral: empties the production port set; see the block
    // comment above — no in-process test dispatches an effect through these adapters.
    ports = {
      // Stryker disable next-line ObjectLiteral: drops the configured MusicBrainz base URL and
      // user agent — observable only in an outbound HTTP request this suite never makes.
      metadata: new MusicBrainzMetadata(fetchHttpClient, {
        baseUrl: config.musicbrainz.baseUrl,
        userAgent: config.musicbrainz.userAgent,
      }),
      search: new SlskdSearch(ledger, slskdClient, realTimer),
      download: slskdDownload,
      // Stryker disable next-line ObjectLiteral: drops the probe kill budget, which only bounds a
      // real ffmpeg spawn; the adapter's own tier pins that the budget is applied.
      probe: new FfmpegAudioProbe(nodeCommandRunner, {
        timeoutMs: config.ffmpeg?.timeoutMs,
      }),
      // Stryker disable next-line ObjectLiteral: drops the library/staging roots, which are read
      // only when an import effect moves files — unreachable without the whole real port set.
      library: new FilesystemLibrary({
        depositRoot: config.depositRoot,
        stagingRoot: config.stagingRoot,
      }),
    };
  } else {
    ports = overrides.ports(downloadObserver);
  }

  await new SourceResourceSweep({
    ledger,
    remover: new SlskdResourceRemover(logger, slskdClient),
    store,
    logger,
  }).run();

  const interpreter: InterpreterDependencies = { store, clock, ports };
  const reactor = new Reactor({
    store,
    checkpoints,
    bus,
    parked: parkedEffects,
    deadLetters,
    stalled: stalledModel,
    logger,
    correlation,
    interpreter,
    clock,
    // The ambient effects the reactor runs on are chosen here, not in the application layer.
    interval: (function_, ms) => {
      const handle = setInterval(function_, ms);
      return () => {
        clearInterval(handle);
      };
    },
    // The re-drive only `await`s this value before dispatching the next stream, so the gap is a
    // rate limit on the upstreams: same streams, same order, same dispatches. See {@link delay} for
    // the mutant this shape exists to keep separable.
    sleep: overrides.reactorTiming?.sleep ?? delay,
    random: overrides.reactorTiming?.random ?? Math.random,
    retryPolicy: { ...DEFAULT_RETRY_POLICY, ...config.reactor?.retry },
  });
  // Boot readiness (reactor-durability D4): the runtime is ready once wired; the catch-up drain
  // and the startup re-drive execute in the background on the reactor's own scheduling. Awaiting
  // them here kept the web interface unbound for the backlog's whole execution (2026-07-22: an
  // album download ran inside boot — a ~2h UI outage). start() cannot reject by construction:
  // its awaited reads are Results and both passes run under the reactor's catching mutex.
  void reactor.start();

  const dependencies: UseCaseDependencies = {
    store,
    clock,
    ids,
    correlation,
    status,
    progress: progressModel,
    stalled: stalledModel,
  };
  const facade = createDownloaderFacade(dependencies);
  const feed = new OutboundFeed(store, publishedEventMapping);
  const wakeups: SeamWakeups = {
    subscribe: (listener) => bus.subscribe(() => listener()),
  };

  // The inbound seam subscription this runtime owns; the composition root connects it, and its
  // halted-on-poison state is this module's one exposed "down" signal (design D4).
  let verdicts: CatchUpSubscription | undefined;

  return ok({
    facade,
    feed,
    wakeups,
    connectVerdictFeed(verdictFeed, verdictWakeups) {
      verdicts = new CatchUpSubscription({
        name: 'seam:verdicts',
        feed: verdictFeed,
        checkpoints,
        deadLetters,
        handler: verdictEventConsumer(dependencies, { warn: logger.warn.bind(logger) }),
        policy: 'halt',
        logger,
        clock,
        retry: { attempts: 3, baseDelayMs: 250 },
        batchSize: 100,
        pollIntervalMs: 5000,
        // The subscription only `await`s this value (retry backoff, and the yield between
        // batches), so the delay is elapsed wall-clock and nothing else: same attempts, same order,
        // same checkpoint advances, same hold/halt decisions. {@link delay} carries the waiver.
        sleep: delay,
        wakeups: verdictWakeups,
      });
      return verdicts;
    },
    readiness() {
      return { status: verdicts?.isHalted ? 'down' : 'up' };
    },
    async stop() {
      // Stop the inbound verdict subscription BEFORE closing the db, and AWAIT it: its poll
      // interval reads the feed and saves checkpoints against this very handle, so leaving it
      // running past db.close() spins an error loop and keeps the event loop alive. Detaching
      // the timer alone only cancels the NEXT cycle — the await is what drains the one already
      // in flight, which is the cycle actually holding the handle.
      await verdicts?.stop();
      reactor.stop();
      // Latch every supervisor watch before closing the store: a watch settling after close
      // would otherwise retry its delivery against the closed handle forever — the same error
      // loop the verdict poller's stop guards against. A latched-away outcome costs at most a
      // repeated transfer next boot (the re-drive re-drives the candidate), never the download.
      slskdDownload?.stop();
      database.close();
    },
  });
}
