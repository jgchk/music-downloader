import { pino } from 'pino';
import type { DestinationStream, Logger } from 'pino';
import { DEFAULT_REDACT_PATHS as DOWNLOADER_REDACT_PATHS } from '@music/downloader/runtime';
import { DEFAULT_REDACT_PATHS as IMPORTER_REDACT_PATHS } from '@music/importer/runtime';

/**
 * The composed process's structured logger — one pino root shared by both module runtimes. It is
 * the ONLY logger production constructs (each module's own `createLogger` exists for its test
 * tiers), so the modules' redaction defaults MUST be composed here: a root without the union
 * would ship every line unredacted — credentials, peer usernames, file contents.
 */
export function createLogger(level: string, destination?: DestinationStream): Logger {
  const paths = [...new Set([...DOWNLOADER_REDACT_PATHS, ...IMPORTER_REDACT_PATHS])];
  const options = { level, redact: { paths, censor: '[REDACTED]' } };
  return destination ? pino(options, destination) : pino(options);
}
