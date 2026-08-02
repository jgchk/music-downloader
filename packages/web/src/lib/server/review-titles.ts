import type { Logger } from 'pino';
import { targetDescription } from '$lib/acquisitions.js';
import type { Facades } from './runtime.js';

/**
 * The review-title composition (reviews-register-alignment D3): a pending review is titled by
 * the musical intent of the acquisition its import arrived from — importId → getImport →
 * acquisitionId → acquisition status → the request phrase the acquisition pages already use. All
 * in-process facade reads, no new contract. Every link is failure-tolerant: a modeled miss
 * (failed read, missing correlation) yields `undefined` quietly, and the caller's fallback chain
 * (basename → neutral phrase) takes over — a title must never take a page down. A *thrown* fault
 * is an unexpected fault and still degrades, but leaves a logged trace (the guardedRead
 * treatment), so a broken store cannot silently demote every title for weeks.
 */
export function acquisitionTitleFor(
  facades: Facades,
  importId: string,
  logger: Logger,
): string | undefined {
  try {
    const importStatus = facades.importer.getImport({ id: importId });
    if (!importStatus.ok) return undefined;
    const acquisitionId = importStatus.value.acquisitionId;
    if (acquisitionId === undefined) return undefined;
    const acquisition = facades.downloader.getAcquisition({ id: acquisitionId });
    if (!acquisition.ok) return undefined;
    return targetDescription(acquisition.value);
  } catch (error) {
    logger.warn(
      { err: error, importId },
      'review title composition failed; degrading to the path fallback',
    );
    return undefined;
  }
}

/** The composed titles for a queue of reviews, keyed by import id; uncomposable entries omitted. */
export function reviewTitlesFor(
  facades: Facades,
  importIds: readonly string[],
  logger: Logger,
): Map<string, string> {
  const titles = new Map<string, string>();
  for (const importId of importIds) {
    const title = acquisitionTitleFor(facades, importId, logger);
    if (title !== undefined) titles.set(importId, title);
  }
  return titles;
}
