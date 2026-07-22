import type { LayoutServerLoad } from './$types';
import { attentionItems } from '$lib/attention.js';

/**
 * The pending-attention count for the site navigation, computed by the same composition as the
 * queue itself (design D3) — no polling endpoint; freshness is page-navigation freshness. The
 * badge is discovery, not truth: a failing module contributes zero here rather than breaking
 * every page, and the queue page models the failure per section.
 */
function safe<T>(read: () => readonly T[]): readonly T[] {
  try {
    return read();
  } catch {
    return [];
  }
}

export const load: LayoutServerLoad = ({ locals }) => {
  const reviews = safe(() => locals.facades.importer.listPendingReviews().reviews);
  const acquisitions = safe(() => locals.facades.downloader.listAcquisitions().acquisitions);
  return { attentionCount: attentionItems(reviews, acquisitions).length };
};
