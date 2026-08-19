import { createDownloaderRuntime } from '@music/downloader/runtime';
import type { DownloaderRuntime } from '@music/downloader/runtime';
import { createImporterRuntime } from '@music/importer/runtime';
import type { ImporterRuntime } from '@music/importer/runtime';
import type { DownloaderFacade } from '@music/downloader';
import type { ImporterFacade } from '@music/importer';
import type { DownloaderReadiness } from '@music/downloader/runtime';
import type { ImporterReadiness } from '@music/importer/runtime';
import type { DestinationStream, Logger } from 'pino';
import { loadComposedConfig } from './config.js';
import { createLogger } from './logger.js';
import { CoverArtArchive } from './cover-art/adapter.js';
import { cachingCoverArt } from './cover-art/cache.js';
import type { CoverArtPort } from './cover-art/port.js';
import { PlexTvAccess } from './plex/adapter.js';
import type { PlexAccessPort } from './plex/port.js';
import { version } from './version.js';

/**
 * The composed process's composition root (design D8): boots both module runtimes — stores,
 * reactors, pollers — and cross-connects the two seam subscriptions (`seam:acquisitions`:
 * importer tails the downloader's fulfilments; `seam:verdicts`: downloader tails the importer's
 * verdicts; wakeups are lossy hints, the fallback poll is the guarantee), all BEFORE the web
 * interface accepts work: SvelteKit's `init` server hook awaits `bootRuntimes` and requests are
 * only served after init resolves. Background processing never depends on page traffic — the
 * reactors and subscriptions run on their own timers in this same process.
 *
 * Startup failures (bad environment, unusable beets config) are values from the loaders that
 * this edge turns into thrown fatals: a composed process with a half-booted daemon must not serve.
 */

export interface Facades {
  readonly downloader: DownloaderFacade;
  readonly importer: ImporterFacade;
}

/**
 * The access-control composition (design D6/D7): the session secret for the pure codec and the one
 * PlexAccess port instance, wired here beside the facades — concretions constructed only in this
 * composition root, and no auth-disabling alternative exists to select.
 */
export interface Access {
  readonly sessionSecret: string;
  readonly plex: PlexAccessPort;
}

/**
 * The composed process's readiness surface (design D4/D6): the server-layer projection routes read
 * to answer `GET /health`. Overall `status` is `ok` only when both module runtimes report `up`,
 * else `degraded`; `version` is the shipped artifact version; each module's live status is
 * enumerated so a degraded response names the culprit. Routes read this — never module internals.
 */
export interface Readiness {
  readonly status: 'ok' | 'degraded';
  readonly version: string;
  readonly modules: {
    readonly downloader: { readonly status: 'up' | 'down' };
    readonly importer: { readonly status: 'up' | 'down' };
  };
}

interface Booted {
  readonly facades: Facades;
  /** The cached cover-art port the request page's artwork endpoint reads. */
  readonly coverArt: CoverArtPort;
  readonly access: Access;
  /** The pino root shared with the module runtimes, exposed so routes can leave a trace too. */
  readonly logger: Logger;
  /** Live readiness accessors captured at boot; invoked per probe so a later halt is honest. */
  readonly readiness: {
    readonly downloader: () => DownloaderReadiness;
    readonly importer: () => ImporterReadiness;
  };
  readonly version: string;
  readonly shutdown: () => Promise<void>;
}

interface Stoppable {
  start(): Promise<void>;
  stop(): Promise<void>;
}

export interface BootOverrides {
  readonly createDownloader?: typeof createDownloaderRuntime;
  readonly createImporter?: typeof createImporterRuntime;
  /** Shutdown-signal registration seam; production wires adapter-node's `sveltekit:shutdown`. */
  readonly onShutdownSignal?: (shutdown: () => Promise<void>) => void;
  /** Log-capture seam for boot/teardown specs; production writes to stdout. */
  readonly logDestination?: DestinationStream;
}

/**
 * Settle every stop and log the failures: a teardown must never mask the error that caused it,
 * and one runtime's failed stop must never skip the other's (its pollers would keep the event
 * loop alive until SIGKILL). Returns whether every stop settled cleanly.
 */
async function didStopsSettle(
  logger: Logger,
  message: string,
  stops: readonly Promise<void>[],
): Promise<boolean> {
  const settled = await Promise.allSettled(stops);
  const failed = settled.filter(
    (outcome): outcome is PromiseRejectedResult => outcome.status === 'rejected',
  );
  for (const failure of failed) {
    logger.error({ err: failure.reason }, message);
  }
  return failed.length === 0;
}

// Boot-once singleton state held on one object so the memoization writes are property
// assignments (the module keeps a single lazily-initialised runtime), not reassignments of a
// module-scoped binding from inside a function.
const runtime: { booted?: Booted; booting?: Promise<Booted> } = {};

function registerProcessShutdown(shutdown: () => Promise<void>, logger: Logger): void {
  // adapter-node stops accepting connections on SIGINT/SIGTERM, then emits this event. The
  // fire-and-forget call has no awaiting caller, so a rejection (e.g. a close racing an in-flight
  // pass) must be observed and logged here — never dropped, never an unhandled rejection.
  const runShutdown = async (): Promise<void> => {
    try {
      await shutdown();
    } catch (error) {
      logger.error({ err: error }, 'shutdown failed');
    }
  };
  process.once('sveltekit:shutdown', () => void runShutdown());
}

async function boot(
  environment: Record<string, string | undefined>,
  overrides: BootOverrides,
): Promise<Booted> {
  const config = loadComposedConfig(environment);
  if (config.isErr()) throw new Error(config.error);

  const logger = createLogger(config.value.logLevel, overrides.logDestination);
  for (const warning of config.value.warnings) logger.warn(warning);

  const downloaderResult = await (overrides.createDownloader ?? createDownloaderRuntime)(
    config.value.downloader,
    logger,
  );
  if (downloaderResult.isErr()) {
    throw new Error(`downloader startup failed: ${downloaderResult.error.detail}`);
  }
  const downloader: DownloaderRuntime = downloaderResult.value;

  const importerResult = await (overrides.createImporter ?? createImporterRuntime)(
    config.value.importer,
    logger,
  );
  if (importerResult.isErr()) {
    // Settled, never bare-awaited: a failing downloader stop must not mask the startup error.
    await didStopsSettle(logger, 'runtime stop failed during boot teardown', [downloader.stop()]);
    throw new Error(`importer startup failed: ${importerResult.error.detail}`);
  }
  const importer: ImporterRuntime = importerResult.value;

  const acquisitions: Stoppable = importer.connectAcquisitionFeed(
    downloader.feed,
    { sourceRoot: config.value.intakeSourceRoot },
    downloader.wakeups,
  );
  const verdicts: Stoppable = downloader.connectVerdictFeed(importer.feed, importer.wakeups);
  try {
    await acquisitions.start();
    await verdicts.start();
  } catch (error) {
    // A subscription whose start throws must not strand two booted runtimes with live pollers
    // behind a rejected boot: stop everything already started, then surface the ORIGINAL fatal —
    // cleanup rejections are logged by didStopsSettle, never thrown over it. The subscription stops
    // settle alongside the runtime stops: each runtime already awaits its own subscription before
    // closing its store, so these are the prompt detach, not the ordering guarantee.
    await didStopsSettle(logger, 'runtime stop failed during boot teardown', [
      acquisitions.stop(),
      verdicts.stop(),
      downloader.stop(),
      importer.stop(),
    ]);
    throw error;
  }

  const shutdown = async (): Promise<void> => {
    const isClean = await didStopsSettle(logger, 'runtime stop failed during shutdown', [
      acquisitions.stop(),
      verdicts.stop(),
      downloader.stop(),
      importer.stop(),
    ]);
    runtime.booted = undefined;
    runtime.booting = undefined;
    // A dirty teardown must not report a clean exit: pollers may be alive until SIGKILL.
    if (!isClean) process.exitCode = 1;
  };
  (overrides.onShutdownSignal ?? ((handler) => registerProcessShutdown(handler, logger)))(shutdown);

  return {
    facades: { downloader: downloader.facade, importer: importer.facade },
    // One cached archive client for the process: covers are re-fetchable, so the cache is a
    // courtesy to the archive and a latency win for the grid, never a source of truth.
    coverArt: cachingCoverArt(new CoverArtArchive({ baseUrl: config.value.coverArt.baseUrl })),
    access: {
      sessionSecret: config.value.access.sessionSecret,
      plex: new PlexTvAccess(config.value.access.plex),
    },
    logger,
    readiness: {
      downloader: () => downloader.readiness(),
      importer: () => importer.readiness(),
    },
    version,
    shutdown,
  };
}

/** Boot once; concurrent and repeated calls share the same boot. */
export function bootRuntimes(
  environment: Record<string, string | undefined> = process.env,
  overrides: BootOverrides = {},
): Promise<Booted> {
  // Memoize the boot *promise* (assign it, don't await it) so concurrent callers share one boot.
  // eslint-disable-next-line unicorn/prefer-await
  runtime.booting ??= boot(environment, overrides).then((result) => {
    runtime.booted = result;
    return result;
  });
  return runtime.booting;
}

/**
 * What the process booted, or nothing when it has not (or has since shut down).
 *
 * ONE accessor, returning the absence rather than crashing on it. Five accessors that each threw
 * "not booted" made the same invariant five undeclared failures on the request path, resolved only
 * by a framework catching them; here the caller sees the absence in the type and answers it once —
 * `handle` with a 503 that says the daemon is not ready, which is exactly what is true.
 */
export function bootedRuntimes(): Booted | undefined {
  return runtime.booted;
}

export function readinessOf(booted: Booted): Readiness {
  const downloader = booted.readiness.downloader();
  const importer = booted.readiness.importer();
  const isHealthy = downloader.status === 'up' && importer.status === 'up';
  return {
    status: isHealthy ? 'ok' : 'degraded',
    version: booted.version,
    modules: {
      downloader: { status: downloader.status },
      importer: { status: importer.status },
    },
  };
}

/** Test seam: tear down the module-scope singleton between specs. */
export async function resetRuntimesForTesting(): Promise<void> {
  const current = runtime.booted;
  runtime.booted = undefined;
  runtime.booting = undefined;
  if (current !== undefined) await current.shutdown();
}
