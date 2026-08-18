import type { LayoutServerLoad } from './$types';
import { orderByNewestRequest } from '$lib/acquisitions.js';
import { guardedRead } from '$lib/server/facade-reads.js';

/**
 * The acquisitions master pane: the list read is guarded so a downloader fault degrades the list to
 * empty-and-flagged while the detail pane and the new-request form — which don't need the list —
 * keep rendering. `selectedId` is the route param (`undefined` on the index and the `/new`
 * sibling), used to mark the current row.
 *
 * The queue is ordered here, newest request first: display order is the BFF's call, and the
 * downloader states each `requestedAt` without deciding one. The ordering sits OUTSIDE the guard
 * deliberately — the guard's second argument is a blame label ('downloader') stamped on whatever it
 * catches, so running the web's own reshape inside it would report a fault in THIS package as the
 * other context's outage. Safe to leave outside: the comparator is total over strings, and a
 * degraded read hands over an empty array.
 */
export const load: LayoutServerLoad = ({ locals, params, route }) => {
  const acquisitions = guardedRead(
    locals.logger,
    'downloader',
    () => locals.facades.downloader.listAcquisitions().acquisitions,
  );
  // An acquisition with no stated request time sorts last, and the queue renders no dates — so the
  // bottom row reads as the oldest thing here, a claim about when the user asked that nobody made.
  // The decider cannot produce such a stream, but a running system can present one (a throw
  // swallowed while applying an event leaves the projection diverged until restart), so the
  // condition leaves a trace naming the streams rather than quietly reordering the queue. A
  // degraded read yields no entries, so a downloader outage cannot trip this.
  const undated = acquisitions.entries.filter((entry) => entry.requestedAt === undefined);
  if (undated.length > 0) {
    locals.logger.warn(
      { module: 'downloader', acquisitionIds: undated.map((entry) => entry.acquisitionId) },
      'acquisitions listed with no requestedAt; they sort last, reading as the oldest in the queue',
    );
  }
  return {
    acquisitions: orderByNewestRequest(acquisitions.entries),
    listFailed: acquisitions.failed,
    selectedId: params.id,
    // Whether a child route (the detail or the new-request form) is what the user asked for, as
    // opposed to the queue itself. Read from SvelteKit's own route identity, which is typed against
    // the generated union — so renaming a route is a compile error here, not a flag that silently
    // goes false and quietly stops the collapse. `params` cannot express this at all: `params.id`
    // is `undefined` on both `/acquisitions` and `/acquisitions/new`, so a params-derived flag is
    // wrong on `/new` even on a cold render. (Reading `route` registers the same re-run dependency
    // `url` would, so the flag still refreshes on a client-side hop between the two.)
    detailActive: route.id !== '/acquisitions',
  };
};
