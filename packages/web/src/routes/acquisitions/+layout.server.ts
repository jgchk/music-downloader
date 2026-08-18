import type { LayoutServerLoad } from './$types';
import { orderByNewestRequest } from '$lib/acquisitions.js';
import { guardedRead } from '$lib/server/facade-reads.js';

/**
 * The acquisitions master pane: the list read is guarded so a downloader fault degrades the list to
 * empty-and-flagged while the detail pane and the new-request form — which don't need the list —
 * keep rendering. `selectedId` is the route param (`undefined` on the index and the `/new`
 * sibling), used to mark the current row.
 *
 * The queue is ordered inside the guard, newest request first. Display order is the BFF's call (the
 * downloader states each `requestedAt` and hands the list over in its projection's map-insertion
 * order — accidentally oldest-first, not a decided one), and ordering inside the guarded read keeps
 * the guard's promise whole: anything the read or the reshape does wrong degrades the pane rather
 * than escaping to 500 the whole page.
 */
export const load: LayoutServerLoad = ({ locals, params, url }) => {
  const acquisitions = guardedRead(locals.logger, 'downloader', () =>
    orderByNewestRequest(locals.facades.downloader.listAcquisitions().acquisitions),
  );
  return {
    acquisitions: acquisitions.entries,
    listFailed: acquisitions.failed,
    selectedId: params.id,
    // Whether a child route (the detail or the new-request form) is what the user asked for, as
    // opposed to the queue itself. Do NOT re-derive this from `params` instead: `params.id` is
    // `undefined` on both `/acquisitions` and `/acquisitions/new`, so the load would not re-run on
    // that client-side hop and the flag would go stale. Reading `url` is what registers the
    // dependency that makes it re-run.
    detailActive: url.pathname.startsWith('/acquisitions/'),
  };
};
