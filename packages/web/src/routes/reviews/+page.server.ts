import type { PageServerLoad } from './$types';
import { attentionItems } from '$lib/attention.js';

/**
 * The attention queue: both module facades composed into one web-owned list (design D1). Each
 * section degrades independently — a failing facade read yields the other module's items plus a
 * modeled section error, never a page-level failure (web-ui spec).
 */
function section<T>(read: () => readonly T[]): { entries: readonly T[]; failed: boolean } {
  try {
    return { entries: read(), failed: false };
  } catch {
    return { entries: [], failed: true };
  }
}

export const load: PageServerLoad = ({ locals }) => {
  const reviews = section(() => locals.facades.importer.listPendingReviews().reviews);
  const acquisitions = section(() => locals.facades.downloader.listAcquisitions().acquisitions);
  return {
    items: attentionItems(reviews.entries, acquisitions.entries),
    errors: {
      importer: reviews.failed ? 'Import reviews are unavailable right now.' : undefined,
      downloader: acquisitions.failed ? 'Acquisitions are unavailable right now.' : undefined,
    },
  };
};
