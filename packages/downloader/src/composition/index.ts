import { randomUUID } from 'node:crypto';
import {
  FfmpegAudioProbe,
  FilesystemLibrary,
  InProcessEventBus,
  MusicBrainzMetadata,
  SlskdClient,
  SlskdDownload,
  SlskdSearch,
  SlskdResourceRemover,
  SqliteCheckpointStore,
  SqliteEventStore,
  SqliteResourceLedger,
  UpcasterRegistry,
  WebhookDispatcher,
  fetchHttpClient,
  openEventDatabase,
  realTimer,
} from '../adapters/index.js';
import { Reactor } from '../application/acquisition/reactor.js';
import { SourceResourceSweep } from '../application/acquisition/sweep.js';
import {
  DEFAULT_WEBHOOK_RETRY,
  WebhookPublisher,
} from '../application/events/webhook-publisher.js';
import type { InterpreterDeps } from '../application/acquisition/interpreter.js';
import type { UseCaseDeps } from '../application/acquisition/use-cases.js';
import { createLogger } from '../application/logging/logger.js';
import type { Clock, IdGenerator } from '../application/ports/system-ports.js';
import {
  AcquisitionStatusProjection,
  LibraryViewProjection,
  ProgressReadModel,
} from '../application/projections/read-models.js';
import { publishedEventMapping } from '../interfaces/contracts/events/mapping.js';
import { buildHttpApp } from '../interfaces/http/app.js';
import { VERDICT_WEBHOOK_PATH } from '../interfaces/http/verdict-webhook.js';
import { loadConfig } from './config.js';
import { readAppVersion } from './version.js';

/**
 * The composition root (D9): the one place that constructs concretes and injects them into the
 * application — vanilla DI, no container framework. It loads and validates config (12-factor),
 * wires the SQLite event store + in-process bus, the outbound adapters behind their ports, the
 * projections, the durable reactor, and the HTTP + MCP interfaces, then wires graceful shutdown.
 * It is intentionally excluded from unit coverage (the E2E tier exercises the wired app); the
 * testable seam — config parsing — lives in `config.ts`.
 */

const clock: Clock = { now: () => new Date() };
const ids: IdGenerator = { next: () => randomUUID() };

async function main(): Promise<void> {
  const logger = createLogger();

  const configResult = loadConfig(process.env);
  if (configResult.isErr()) {
    logger.error({ error: configResult.error }, 'invalid configuration; aborting startup');
    process.exit(1);
  }
  const config = configResult.value;

  // --- Persistence + bus -----------------------------------------------------------------------
  const db = openEventDatabase(config.databaseFile);
  const bus = new InProcessEventBus();
  const store = new SqliteEventStore(db, new UpcasterRegistry(), bus);
  const checkpoints = new SqliteCheckpointStore(db);
  const ledger = new SqliteResourceLedger(db, clock);

  // --- Projections (rebuilt from the log at startup, then followed live) ------------------------
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

  // --- Outbound adapters behind their ports ----------------------------------------------------
  const slskdClient = new SlskdClient(fetchHttpClient, {
    baseUrl: config.slskd.baseUrl,
    apiKey: config.slskd.apiKey,
  });
  const metadata = new MusicBrainzMetadata(logger, fetchHttpClient, {
    baseUrl: config.musicbrainz.baseUrl,
    userAgent: config.musicbrainz.userAgent,
  });
  const probe = new FfmpegAudioProbe(logger);
  const search = new SlskdSearch(logger, ledger, slskdClient, realTimer);
  const download = new SlskdDownload(
    logger,
    ledger,
    { stagingRoot: config.stagingRoot },
    slskdClient,
    realTimer,
  );
  const library = new FilesystemLibrary(
    { libraryRoot: config.libraryRoot, stagingRoot: config.stagingRoot },
    logger,
  );

  // --- Startup sweep: finish any source-resource removals a prior run left owing, before the
  //     reactor starts firing new effects (so the two never contend for the same resource). --------
  await new SourceResourceSweep({
    ledger,
    remover: new SlskdResourceRemover(logger, slskdClient),
    store,
    logger,
  }).run();

  // --- The durable reactor (fires effects; feeds results back through decide) -------------------
  const interpreter: InterpreterDeps = {
    store,
    clock,
    ports: { metadata, search, download, probe, library },
    onProgress: (acquisitionId, _candidate, progress) => {
      progressModel.update(acquisitionId, progress);
    },
  };
  const reactor = new Reactor({ store, checkpoints, bus, logger, interpreter });
  await reactor.start();

  // --- The outbound webhook publisher (config-dormant): one more checkpointed consumer of the
  //     event store (the store IS the outbox), delivering published events to each subscriber
  //     independently, in order, at-least-once. Absent WEBHOOK_URLS, nothing here exists. ---------
  let publisher: WebhookPublisher | undefined;
  if (config.webhooks !== undefined) {
    const dispatcher = new WebhookDispatcher(logger, fetchHttpClient, clock, {
      secret: config.webhooks.secret,
    });
    publisher = new WebhookPublisher({
      store,
      checkpoints,
      bus,
      logger,
      mapping: publishedEventMapping,
      deliver: dispatcher,
      subscribers: config.webhooks.urls,
      retry: DEFAULT_WEBHOOK_RETRY,
      sleep: (ms) => realTimer.sleep(ms),
    });
    await publisher.start();
    logger.info({ subscribers: config.webhooks.urls.length }, 'webhook publisher started');
  }

  // --- Inbound interfaces: one HTTP server serves both REST and MCP (streamable HTTP) ----------
  // MCP is mounted on the same Fastify app (`POST /mcp`) over the same use-cases, so every client —
  // HTTP or MCP — talks to this one process. That is what lets an acquisition submitted over HTTP be
  // observed or cancelled over MCP; the retired stdio transport forced a client-spawned second
  // process that raced this one's reactor and read stale projections.
  const deps: UseCaseDeps = { store, clock, ids, status, progress: progressModel };
  const httpApp = await buildHttpApp(deps, logger, readAppVersion(), {
    verdictWebhook: config.verdictWebhook,
  });
  // The inbound verdict receiver is config-dormant (fulfillment-external-verdict D4): without
  // VERDICT_WEBHOOK_SECRET the route does not exist and the tool behaves exactly as before.
  if (config.verdictWebhook !== undefined) {
    logger.info({ path: VERDICT_WEBHOOK_PATH }, 'verdict webhook receiver active');
  } else {
    logger.info('verdict webhook receiver dormant (no VERDICT_WEBHOOK_SECRET)');
  }
  await httpApp.listen({ port: config.httpPort, host: config.host });

  logger.info({ port: config.httpPort, host: config.host }, 'music-downloader started');

  // --- Graceful shutdown: stop reacting, drain in-flight HTTP (incl. MCP), close resources -------
  const shutdown = async (signal: string): Promise<void> => {
    logger.info({ signal }, 'shutting down');
    reactor.stop();
    publisher?.stop();
    await httpApp.close();
    db.close();
    process.exit(0);
  };
  process.on('SIGTERM', () => void shutdown('SIGTERM'));
  process.on('SIGINT', () => void shutdown('SIGINT'));
}

void main().catch((error: unknown) => {
  process.stderr.write(`fatal: ${String(error)}\n`);
  process.exit(1);
});
