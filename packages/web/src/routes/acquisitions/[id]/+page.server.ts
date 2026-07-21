import { error, fail, redirect } from '@sveltejs/kit';
import { messageOf, statusOf } from '$lib/server/facade-errors.js';
import type { Actions, PageServerLoad } from './$types';

/**
 * The acquisition detail: status + (while downloading) live progress from the facade's read
 * models; the cancel action dispatches the facade's cancel command (web-ui 6.2/6.3). A missing
 * acquisition is a page-level 404.
 */
export const load: PageServerLoad = ({ locals, params }) => {
  const status = locals.facades.downloader.getAcquisition({ id: params.id });
  if (!status.ok) error(statusOf(status.error), messageOf(status.error));

  const progress =
    status.value.status === 'Downloading'
      ? locals.facades.downloader.getAcquisitionProgress({ id: params.id })
      : undefined;

  return {
    acquisition: status.value,
    progress: progress?.ok === true ? progress.value : undefined,
  };
};

export const actions: Actions = {
  cancel: async ({ locals, params }) => {
    const result = await locals.facades.downloader.cancelAcquisition({ id: params.id });
    if (!result.ok) {
      return fail(statusOf(result.error), { message: messageOf(result.error) });
    }
    redirect(303, `/acquisitions/${params.id}`);
  },
};
