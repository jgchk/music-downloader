import { createDownloaderRuntime } from '@music/downloader/runtime';
import type { DownloaderRuntime } from '@music/downloader/runtime';
import { createImporterRuntime } from '@music/importer/runtime';
import type { ImporterRuntime } from '@music/importer/runtime';
import type { DownloaderFacade } from '@music/downloader';
import type { ImporterFacade } from '@music/importer';
import type { DownloaderReadiness } from '@music/downloader/runtime';
import type { ImporterReadiness } from '@music/importer/runtime';
import type { Logger } from 'pino';
import { loadComposedConfig } from './config.js';
import { createLogger } from './logger.js';
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

type Stoppable = { start(): Promise<void>; stop(): void };

export interface BootOverrides {
  readonly createDownloader?: typeof createDownloaderRuntime;
  readonly createImporter?: typeof createImporterRuntime;
  /** Shutdown-signal registration seam; production wires adapter-node's `sveltekit:shutdown`. */
  readonly onShutdownSignal?: (shutdown: () => Promise<void>) => void;
}

// Boot-once singleton state held on one object so the memoization writes are property
// assignments (the module keeps a single lazily-initialised runtime), not reassignments of a
// module-scoped binding from inside a function.
const runtime: { booted?: Booted; booting?: Promise<Booted> } = {};

function registerProcessShutdown(shutdown: () => Promise<void>): void {
  // adapter-node stops accepting connections on SIGINT/SIGTERM, then emits this event.
  process.once('sveltekit:shutdown', () => void shutdown());
}

async function boot(
  environment: Record<string, string | undefined>,
  overrides: BootOverrides,
): Promise<Booted> {
  const config = loadComposedConfig(environment);
  if (config.isErr()) throw new Error(config.error);

  const logger = createLogger(config.value.logLevel);

  const downloader: DownloaderRuntime = await (
    overrides.createDownloader ?? createDownloaderRuntime
  )(config.value.downloader, logger);

  const importerResult = await (overrides.createImporter ?? createImporterRuntime)(
    config.value.importer,
    logger,
  );
  if (importerResult.isErr()) {
    await downloader.stop();
    throw new Error(`importer startup failed: ${importerResult.error.detail}`);
  }
  const importer: ImporterRuntime = importerResult.value;

  const acquisitions: Stoppable = importer.connectAcquisitionFeed(
    downloader.feed,
    { sourceRoot: config.value.intakeSourceRoot },
    downloader.wakeups,
  );
  const verdicts: Stoppable = downloader.connectVerdictFeed(importer.feed, importer.wakeups);
  await acquisitions.start();
  await verdicts.start();

  const shutdown = async (): Promise<void> => {
    acquisitions.stop();
    verdicts.stop();
    await downloader.stop();
    await importer.stop();
    runtime.booted = undefined;
    runtime.booting = undefined;
  };
  (overrides.onShutdownSignal ?? registerProcessShutdown)(shutdown);

  return {
    facades: { downloader: downloader.facade, importer: importer.facade },
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

/** The facades for request handling; the daemon must have booted first (init hook). */
export function facadesOf(): Facades {
  if (runtime.booted === undefined) {
    throw new Error('runtimes not booted — the init hook must run before requests are served');
  }
  return runtime.booted.facades;
}

/** The structured logger for request handling; the daemon must have booted first (init hook). */
export function loggerOf(): Logger {
  if (runtime.booted === undefined) {
    throw new Error('runtimes not booted — the init hook must run before requests are served');
  }
  return runtime.booted.logger;
}

/**
 * The readiness surface for `GET /health` (design D4/D6): reads each module runtime's live
 * readiness accessor and the shipped version — no event-store scan, no module-internal reach.
 * Overall `ok` only when both modules are `up`, else `degraded`. The daemon must have booted first.
 */
export function readinessOf(): Readiness {
  if (runtime.booted === undefined) {
    throw new Error('runtimes not booted — the init hook must run before requests are served');
  }
  const downloader = runtime.booted.readiness.downloader();
  const importer = runtime.booted.readiness.importer();
  const isHealthy = downloader.status === 'up' && importer.status === 'up';
  return {
    status: isHealthy ? 'ok' : 'degraded',
    version: runtime.booted.version,
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
