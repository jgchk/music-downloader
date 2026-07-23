import type { PageServerLoad } from './$types';
import { guardedRead } from '$lib/server/facade-reads.js';
import { parseSection } from '$lib/landing.js';

/**
 * The landing load: a composed read view (module-architecture — independent facade queries to
 * each module, no writes, no cross-module workflow). Proves the BFF's in-process facade path
 * end to end. Each stat is a guarded read (like every other attention surface) parsed at this
 * boundary into a discriminated `SectionView`: a faulting module is logged and degrades its own
 * stat to an `unavailable` apology rather than taking the dashboard down or showing a false zero.
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
    acquisitions: parseSection(acquisitions, 'Acquisitions are unavailable right now.'),
    pendingReviews: parseSection(reviews, 'Import reviews are unavailable right now.'),
  };
};
