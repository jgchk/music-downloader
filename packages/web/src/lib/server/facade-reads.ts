import type { Logger } from 'pino';

/**
 * The degrade-a-facade-read guard shared by the attention surfaces. The list facades return plain
 * values, so anything they throw is an unexpected fault — it must not take the page down (web-ui
 * spec: one module failing never empties the queue), but it must leave a trace: the fault is
 * logged before the section degrades to empty-and-failed.
 */
export function guardedRead<T>(
  logger: Logger,
  module: 'importer' | 'downloader',
  read: () => readonly T[],
): { entries: readonly T[]; failed: boolean } {
  try {
    return { entries: read(), failed: false };
  } catch (error) {
    logger.warn({ err: error, module }, 'facade read failed; degrading the attention surface');
    return { entries: [], failed: true };
  }
}
