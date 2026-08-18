import type { LayoutServerLoad } from './$types';
import { orderByNewestRequest } from '$lib/acquisitions.js';
import { guardedRead } from '$lib/server/facade-reads.js';

/**
 * The acquisitions master pane: the list read is guarded (web-ui spec: one module failing never
 * empties the queue) so a downloader fault degrades the list to empty-and-flagged while the detail
 * pane and the new-request form — which don't need the list — keep rendering. `selectedId` is the
 * route param (`undefined` on the index and the `/new` sibling), used to mark the current row.
 * The queue is ordered here, newest request first — display order is the BFF's call, and the
 * downloader's list arrives in stream order, which is not one.
 */
export const load: LayoutServerLoad = ({ locals, params, url }) => {
  const acquisitions = guardedRead(
    locals.logger,
    'downloader',
    () => locals.facades.downloader.listAcquisitions().acquisitions,
  );
  return {
    acquisitions: orderByNewestRequest(acquisitions.entries),
    listFailed: acquisitions.failed,
    selectedId: params.id,
    // Whether a child route (the detail or the new-request form) is what the user asked for, as
    // opposed to the queue itself. Read from the path — reading `url` is also what makes this load
    // re-run on a client-side hop between the index and a child, keeping the flag honest.
    detailActive: url.pathname.startsWith('/acquisitions/'),
  };
};
