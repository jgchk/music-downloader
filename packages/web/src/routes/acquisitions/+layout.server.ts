import type { LayoutServerLoad } from './$types';

/**
 * The acquisitions master pane: one facade read model (web-ui: progress observation), shared by
 * the index and every `[id]` detail view so the list stays put while a selection is inspected.
 * The selected id is derived from the URL — the layout's own params don't carry the child `[id]`
 * — so the list can mark the current row. `new` is a sibling route, not a selection.
 */
export const load: LayoutServerLoad = ({ locals, url }) => {
  const match = /^\/acquisitions\/([^/]+)\/?$/.exec(url.pathname);
  const selectedId = match && match[1] !== 'new' ? match[1] : undefined;
  return { list: locals.facades.downloader.listAcquisitions(), selectedId };
};
