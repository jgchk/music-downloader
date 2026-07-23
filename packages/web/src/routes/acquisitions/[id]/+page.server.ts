import { error, fail, redirect } from '@sveltejs/kit';
import type { ImportStatusResponseDto } from '@music/importer';
import { messageOf, statusOf } from '$lib/server/facade-errors.js';
import { mergeTimeline } from '$lib/timeline.js';
import type { Actions, PageServerLoad } from './$types';

/**
 * The import side of an acquisition, composed web-side alongside the downloader read (web-ui: the
 * timeline spans both contexts, degrading each section independently). `none` is the normal state
 * for an acquisition not yet handed off; `unavailable` is a read that failed and is logged — both
 * keep the page up rather than failing it.
 */
type ImportSection =
  | { readonly state: 'present'; readonly status: ImportStatusResponseDto }
  | { readonly state: 'none' }
  | { readonly state: 'unavailable' };

function importSectionFor(locals: App.Locals, acquisitionId: string): ImportSection {
  try {
    const result = locals.facades.importer.getImportForAcquisition({ acquisitionId });
    if (result.ok) return { state: 'present', status: result.value };
    // A not-yet-submitted acquisition is the expected `NotFound`, not a fault: no import section.
    if (result.error.kind === 'NotFound') return { state: 'none' };
    locals.logger.warn(
      { acquisitionId, err: result.error },
      'import status unavailable for an acquisition',
    );
    return { state: 'unavailable' };
  } catch (error_) {
    // An unexpected throw from the importer read must degrade this section, never the page.
    locals.logger.warn(
      { acquisitionId, err: error_ },
      'import status read threw for an acquisition',
    );
    return { state: 'unavailable' };
  }
}

/**
 * The acquisition detail: the acquisition's status plus its full download-through-import history as
 * one timeline (web-ui) — the downloader's steps merged with the importer's, composed web-side from
 * the two facades' read models — and, while downloading, live progress. The cancel action
 * dispatches the facade's cancel command (web-ui 6.2/6.3). A missing acquisition is a page-level
 * 404; a missing or unavailable import degrades to its own section, never the page.
 */
export const load: PageServerLoad = ({ locals, params }) => {
  const status = locals.facades.downloader.getAcquisition({ id: params.id });
  if (!status.ok) error(statusOf(status.error), messageOf(status.error));

  const acquisition = status.value;
  const importSection = importSectionFor(locals, params.id);
  const timeline = mergeTimeline(
    acquisition.history,
    importSection.state === 'present' ? importSection.status.history : [],
  );
  const base = { acquisition, timeline, importState: importSection.state };

  if (acquisition.status !== 'Downloading') {
    return { ...base, progress: undefined, progressUnavailable: false };
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
    return { ...base, progress: undefined, progressUnavailable: true };
  }

  return { ...base, progress: progress.value, progressUnavailable: false };
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
