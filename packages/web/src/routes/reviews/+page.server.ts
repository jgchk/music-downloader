import type { PageServerLoad } from './$types';
import { attentionItems } from '$lib/attention.js';
import { guardedRead } from '$lib/server/facade-reads.js';

/**
 * The attention queue: both module facades composed into one web-owned list (design D1). Each
 * section degrades independently — a failing facade read is logged and yields the other module's
 * items plus a modeled section error, never a page-level failure (web-ui spec).
 */
export const load: PageServerLoad = ({ locals }) => {
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
  return {
    items: attentionItems(reviews.entries, acquisitions.entries),
    errors: {
      importer: reviews.failed ? 'Import reviews are unavailable right now.' : undefined,
      downloader: acquisitions.failed ? 'Acquisitions are unavailable right now.' : undefined,
    },
  };
};
