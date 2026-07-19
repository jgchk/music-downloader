import { createLogger } from '../application/logging/logger.js';
import { buildHttpApp } from '../interfaces/http/app.js';
import { loadConfig } from './config.js';
import { readAppVersion } from './version.js';

/**
 * The composition root: the one place that constructs concretes and injects them — vanilla DI, no
 * container framework. It loads and validates config (12-factor), builds the HTTP app, and wires
 * graceful shutdown. Intentionally excluded from unit coverage (the E2E tier exercises the wired
 * app); the testable seams — config parsing, version reading, the app itself — live beside it.
 */

async function main(): Promise<void> {
  const logger = createLogger();

  const configResult = loadConfig(process.env);
  if (configResult.isErr()) {
    logger.error({ error: configResult.error }, 'invalid configuration; aborting startup');
    process.exit(1);
  }
  const config = configResult.value;

  const app = await buildHttpApp(logger, readAppVersion());

  const shutdown = (signal: string): void => {
    logger.info({ signal }, 'shutting down');
    void app.close().then(() => process.exit(0));
  };
  process.on('SIGINT', () => shutdown('SIGINT'));
  process.on('SIGTERM', () => shutdown('SIGTERM'));

  await app.listen({ port: config.httpPort, host: '0.0.0.0' });
  logger.info({ port: config.httpPort }, 'music-importer started');
}

main().catch((error: unknown) => {
  console.error('fatal startup error', error);
  process.exit(1);
});
