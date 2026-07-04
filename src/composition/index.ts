import { randomUUID } from 'node:crypto';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import {
  FfmpegAudioProbe,
  FilesystemLibrary,
  InProcessEventBus,
  MusicBrainzMetadata,
  SlskdClient,
  SlskdDownload,
  SlskdSearch,
  SqliteCheckpointStore,
  SqliteEventStore,
  UpcasterRegistry,
  fetchHttpClient,
  openEventDatabase,
  realTimer,
} from '../adapters/index.js';
import { Reactor } from '../application/acquisition/reactor.js';
import type { InterpreterDeps } from '../application/acquisition/interpreter.js';
import type { UseCaseDeps } from '../application/acquisition/use-cases.js';
import { createLogger } from '../application/logging/logger.js';
import type { Clock, IdGenerator } from '../application/ports/system-ports.js';
import {
  AcquisitionStatusProjection,
  LibraryViewProjection,
  ProgressReadModel,
} from '../application/projections/read-models.js';
import { buildHttpApp } from '../interfaces/http/app.js';
import { buildMcpServer } from '../interfaces/mcp/server.js';
import { loadConfig } from './config.js';

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
  const search = new SlskdSearch(logger, slskdClient, realTimer);
  const download = new SlskdDownload(
    logger,
    { stagingRoot: config.stagingRoot },
    slskdClient,
    realTimer,
  );
  const library = new FilesystemLibrary(
    { libraryRoot: config.libraryRoot, stagingRoot: config.stagingRoot },
    logger,
  );

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

  // --- Inbound interfaces (both over the same use-cases) ---------------------------------------
  const deps: UseCaseDeps = { store, clock, ids, status, progress: progressModel };
  const httpApp = await buildHttpApp(deps, logger);
  await httpApp.listen({ port: config.httpPort, host: config.host });

  const mcpServer = buildMcpServer(deps, logger);
  await mcpServer.connect(new StdioServerTransport());

  logger.info({ port: config.httpPort, host: config.host }, 'music-downloader started');

  // --- Graceful shutdown: stop reacting, drain in-flight HTTP, close resources ------------------
  const shutdown = async (signal: string): Promise<void> => {
    logger.info({ signal }, 'shutting down');
    reactor.stop();
    await httpApp.close();
    await mcpServer.close();
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
