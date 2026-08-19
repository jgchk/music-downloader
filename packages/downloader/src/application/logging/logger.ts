import { pino } from 'pino';
import type { DestinationStream, Logger as PinoLogger, LoggerOptions as PinoOptions } from 'pino';

/**
 * The application-wide structured logger (D15). Logging lives in the imperative shell,
 * adapters, and interfaces — never in the pure domain.
 */
export type Logger = PinoLogger;

export const DEFAULT_LOG_LEVEL = 'info';

/**
 * Paths pino redacts so credentials, file contents, and third-party PII never reach the log
 * stream (D15). Wildcards match the field at any object depth pino supports. Soulseek peer
 * usernames are other people's identifiers (the same leak class the contract recorder scrubs
 * from fixtures) — adapters log them only as structured `username` fields so one path here
 * covers every site.
 */
export const DEFAULT_REDACT_PATHS: readonly string[] = [
  'password',
  'apiKey',
  'token',
  'authorization',
  '*.password',
  '*.apiKey',
  '*.token',
  '*.authorization',
  'req.headers.authorization',
  'fileContents',
  '*.fileContents',
  'username',
  '*.username',
  // One level deeper, for the seam drain's `err.cause` — the producer's own error, nested under the
  // classification. The wildcards above are single-level (`*.username` matches `err.username`, not
  // `err.cause.username`), and a redaction guarantee reaches exactly as far as its paths say.
  'err.cause.password',
  'err.cause.apiKey',
  'err.cause.token',
  'err.cause.authorization',
  'err.cause.fileContents',
  'err.cause.username',
];

export interface CreateLoggerOptions {
  /** Explicit level; falls back to the `LOG_LEVEL` env var, then {@link DEFAULT_LOG_LEVEL}. */
  level?: string;
  /** Redaction paths; falls back to {@link DEFAULT_REDACT_PATHS}. */
  redactPaths?: readonly string[];
  /** Destination stream; when omitted pino writes to stdout (12-factor logs-as-streams). */
  destination?: DestinationStream;
}

/**
 * Build the structured JSON logger. Level and redaction are configurable from the
 * environment (12-factor); output defaults to stdout so the runtime aggregates it.
 */
export function createLogger(options: CreateLoggerOptions = {}): Logger {
  const level = options.level ?? process.env.LOG_LEVEL ?? DEFAULT_LOG_LEVEL;
  const redactPaths = options.redactPaths ?? DEFAULT_REDACT_PATHS;
  const pinoOptions: PinoOptions = {
    level,
    redact: { paths: [...redactPaths], censor: '[REDACTED]' },
  };
  return options.destination ? pino(pinoOptions, options.destination) : pino(pinoOptions);
}
