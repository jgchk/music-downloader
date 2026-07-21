import type { PageServerLoad } from './$types';

/** The acquisitions list: one facade read model, no writes (web-ui: progress observation). */
export const load: PageServerLoad = ({ locals }) => {
  return { list: locals.facades.downloader.listAcquisitions() };
};
