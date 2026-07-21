import type { PageServerLoad } from './$types';

/**
 * The landing load: a composed read view (module-architecture — independent facade queries to
 * each module, no writes, no cross-module workflow). Proves the BFF's in-process facade path
 * end to end.
 */
export const load: PageServerLoad = ({ locals }) => {
  return {
    counts: {
      acquisitions: locals.facades.downloader.listAcquisitions().acquisitions.length,
      pendingReviews: locals.facades.importer.listPendingReviews().reviews.length,
    },
  };
};
