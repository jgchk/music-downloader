import type { PageServerLoad } from './$types';

/** The review queue: the importer facade's pending reviews, kind-labeled with carried context. */
export const load: PageServerLoad = ({ locals }) => {
  return { list: locals.facades.importer.listPendingReviews() };
};
