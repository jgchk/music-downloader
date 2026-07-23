import type { LayoutServerLoad } from './$types';
import { guardedRead } from '$lib/server/facade-reads.js';

/**
 * The acquisitions master pane: the list read is guarded (web-ui spec: one module failing never
 * empties the queue) so a downloader fault degrades the list to empty-and-flagged while the detail
 * pane and the new-request form — which don't need the list — keep rendering. `selectedId` is the
 * route param (`undefined` on the index and the `/new` sibling), used to mark the current row.
 */
export const load: LayoutServerLoad = ({ locals, params }) => {
  const acquisitions = guardedRead(
    locals.logger,
    'downloader',
    () => locals.facades.downloader.listAcquisitions().acquisitions,
  );
  return {
    acquisitions: acquisitions.entries,
    listFailed: acquisitions.failed,
    selectedId: params.id,
  };
};
