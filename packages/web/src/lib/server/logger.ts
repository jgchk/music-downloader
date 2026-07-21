import { pino } from 'pino';
import type { Logger } from 'pino';

/** The composed process's structured logger — one pino root shared by both module runtimes. */
export function createLogger(level: string): Logger {
  return pino({ level });
}
