import { createLogger } from '../application/logging/logger.js';
import { buildHttpApp } from '../interfaces/http/app.js';
import { loadConfig } from './config.js';
import { createImporterRuntime } from './runtime.js';
import { readAppVersion } from './version.js';

/**
 * The module's standalone process entry: config from the environment, the runtime factory, and
 * the HTTP + MCP interfaces over the facade. The composed product entry (packages/web) uses the
 * same runtime factory; this entry remains for running the module alone and dies with the
 * interface consolidation (merge-modular-monolith group 6).
 */
async function main(): Promise<void> {
  const logger = createLogger();

  const configResult = loadConfig(process.env);
  if (configResult.isErr()) {
    logger.error({ error: configResult.error }, 'invalid configuration; aborting startup');
    process.exit(1);
  }
  const config = configResult.value;

  const runtimeResult = await createImporterRuntime(
    {
      databaseFile: config.databaseFile,
      intakeRoot: config.intakeRoot,
      beetsConfigPath: config.beetsConfigPath,
      bridgePython: config.bridgePython,
      bridgeTimeoutMs: config.bridgeTimeoutMs,
      autoApplyThreshold: config.autoApplyThreshold,
    },
    logger,
  );
  if (runtimeResult.isErr()) {
    logger.error({ err: runtimeResult.error }, 'beets configuration unusable; aborting startup');
    process.exit(1);
  }
  const runtime = runtimeResult.value;

  const httpApp = await buildHttpApp(runtime.facade, logger, readAppVersion(), {
    beetsConfig: runtime.beetsConfig,
  });
  await httpApp.listen({ port: config.httpPort, host: config.host });

  logger.info({ port: config.httpPort, host: config.host }, 'music-importer started');

  const shutdown = async (signal: string): Promise<void> => {
    logger.info({ signal }, 'shutting down');
    await httpApp.close();
    await runtime.stop();
    process.exit(0);
  };
  process.on('SIGTERM', () => void shutdown('SIGTERM'));
  process.on('SIGINT', () => void shutdown('SIGINT'));
}

void main().catch((error: unknown) => {
  process.stderr.write(`fatal: ${String(error)}\n`);
  process.exit(1);
});
