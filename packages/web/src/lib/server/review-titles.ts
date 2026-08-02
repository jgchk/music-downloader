import { targetDescription } from '$lib/acquisitions.js';
import type { Facades } from './runtime.js';

/**
 * The review-title composition (design D3): a pending review is titled by the musical intent of
 * the acquisition its import arrived from — importId → getImport → acquisitionId → acquisition
 * status → the request phrase the acquisition pages already use. All in-process facade reads, no
 * new contract. Every link is failure-tolerant: a missing correlation, failed read, or thrown
 * fault yields `undefined`, and the caller's fallback chain (basename → neutral phrase) takes
 * over — a title must never take a page down.
 */
export function acquisitionTitleFor(facades: Facades, importId: string): string | undefined {
  try {
    const importStatus = facades.importer.getImport({ id: importId });
    if (!importStatus.ok) return undefined;
    const acquisitionId = importStatus.value.acquisitionId;
    if (acquisitionId === undefined) return undefined;
    const acquisition = facades.downloader.getAcquisition({ id: acquisitionId });
    if (!acquisition.ok) return undefined;
    return targetDescription(acquisition.value);
  } catch {
    return undefined;
  }
}

/** The composed titles for a queue of reviews, keyed by import id; uncomposable entries omitted. */
export function reviewTitlesFor(
  facades: Facades,
  importIds: readonly string[],
): Map<string, string> {
  const titles = new Map<string, string>();
  for (const importId of importIds) {
    const title = acquisitionTitleFor(facades, importId);
    if (title !== undefined) titles.set(importId, title);
  }
  return titles;
}
