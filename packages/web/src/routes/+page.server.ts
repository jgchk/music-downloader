import type { PageServerLoad } from './$types';
import { guardedRead } from '$lib/server/facade-reads.js';

/**
 * The landing load: a composed read view (module-architecture — independent facade queries to
 * each module, no writes, no cross-module workflow). Proves the BFF's in-process facade path
 * end to end. Each count is a guarded read (like every other attention surface): a faulting module
 * is logged and degrades its own stat to an apology rather than taking the dashboard down or
 * showing a false zero.
 */
export const load: PageServerLoad = ({ locals }) => {
  const acquisitions = guardedRead(
    locals.logger,
    'downloader',
    () => locals.facades.downloader.listAcquisitions().acquisitions,
  );
  const reviews = guardedRead(
    locals.logger,
    'importer',
    () => locals.facades.importer.listPendingReviews().reviews,
  );
  return {
    counts: {
      acquisitions: acquisitions.entries.length,
      pendingReviews: reviews.entries.length,
    },
    errors: {
      acquisitions: acquisitions.failed ? 'Acquisitions are unavailable right now.' : undefined,
      pendingReviews: reviews.failed ? 'Import reviews are unavailable right now.' : undefined,
    },
  };
};
