import type { LayoutServerLoad } from './$types';
import { attentionItems } from '$lib/attention.js';
import { guardedRead } from '$lib/server/facade-reads.js';

/**
 * The pending-attention count for the site navigation, computed by the same composition as the
 * queue itself (design D3) — no polling endpoint. Freshness is page-navigation freshness for the
 * chrome; the acquisition detail page is the one revision (legible-acquisition-history D8): while
 * its acquisition is unsettled it re-runs its own load on an interval behind a swappable
 * freshness-driver seam, with SSE as the intended successor — still no new wire endpoint. The
 * badge is discovery, not truth: a failing module read is logged and contributes zero here
 * rather than breaking every page; the queue page models the failure per section.
 *
 * Without a session (the open login page), the layout reads NOTHING: no facade call runs and no
 * count leaks to an unauthenticated visitor — the chrome renders signed-out (web-access-control).
 */
export const load: LayoutServerLoad = ({ locals, url }) => {
  if (locals.session === undefined) {
    return { attentionCount: 0, pathname: url.pathname, username: undefined };
  }
  const reviews = guardedRead(
    locals.logger,
    'importer',
    () => locals.facades.importer.listPendingReviews().reviews,
  );
  const acquisitions = guardedRead(
    locals.logger,
    'downloader',
    () => locals.facades.downloader.listAcquisitions().acquisitions,
  );
  return {
    attentionCount: attentionItems(reviews.entries, acquisitions.entries).length,
    // The current path drives the primary nav's active-tab state in +layout.svelte.
    pathname: url.pathname,
    // Whose session this is — the masthead shows it beside the sign-out control.
    username: locals.session.username,
  };
};
