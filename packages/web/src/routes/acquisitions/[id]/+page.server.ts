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

  if (status.value.status !== 'Downloading') {
    return { acquisition: status.value, progress: undefined, progressUnavailable: false };
  }

  const progress = locals.facades.downloader.getAcquisitionProgress({ id: params.id });
  if (!progress.ok) {
    // Don't collapse a failed progress read to the same `undefined` as "not downloading": while
    // Downloading the reachable error is a cross-projection inconsistency (the "pending forever"
    // family), not a just-started download. Log it with the id, and tell the view the bar is
    // unavailable so it can say so instead of rendering an indistinguishable blank.
    locals.logger.warn(
      { acquisitionId: params.id, err: progress.error },
      'progress unavailable for a downloading acquisition',
    );
    return { acquisition: status.value, progress: undefined, progressUnavailable: true };
  }

  return { acquisition: status.value, progress: progress.value, progressUnavailable: false };
};

export const actions: Actions = {
  cancel: async ({ locals, params }) => {
    const result = await locals.facades.downloader.cancelAcquisition({ id: params.id });
    if (!result.ok) {
      return fail(statusOf(result.error), { message: messageOf(result.error) });
    }
    redirect(303, `/acquisitions/${params.id}`);
  },

  // Manual edition selection: submit the chosen edition; a stale or off-menu choice comes back as
  // the facade's modeled rejection and renders as the action error, never a crash (web-ui spec).
  select: async ({ locals, params, request }) => {
    const data = await request.formData();
    const releaseMbid = data.get('releaseMbid');
    const result = await locals.facades.downloader.selectEdition({
      id: params.id,
      releaseMbid: typeof releaseMbid === 'string' ? releaseMbid : '',
    });
    if (!result.ok) {
      return fail(statusOf(result.error), { message: messageOf(result.error) });
    }
    redirect(303, `/acquisitions/${params.id}`);
  },
};
