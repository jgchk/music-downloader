import type { LayoutServerLoad } from './$types';
import { attentionItems } from '$lib/attention.js';
import { guardedRead } from '$lib/server/facade-reads.js';

/**
 * The pending-attention count for the site navigation, computed by the same composition as the
 * queue itself (design D3) — no polling endpoint; freshness is page-navigation freshness. The
 * badge is discovery, not truth: a failing module read is logged and contributes zero here
 * rather than breaking every page; the queue page models the failure per section.
 */
export const load: LayoutServerLoad = ({ locals }) => {
  const reviews = guardedRead(
    locals.logger,
    'importer',
    () => locals.facades.importer.listPendingReviews().reviews,
  );
  const acquisitions = guardedRead(
    locals.logger,
    'downloader',
    () => locals.facades.downloader.listAcquisitions().acquisitions,
  );
  return { attentionCount: attentionItems(reviews.entries, acquisitions.entries).length };
};
