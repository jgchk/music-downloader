import { isCatalogId } from './view.js';
import type { CatalogClient } from './client.js';
import type { DetailContext, DetailState, TracklistState } from './detail.js';
import type { EntityKind } from './view.js';
import type { CatalogLookupResultDto, CatalogSearchResultDto } from '@music/downloader';

/**
 * The request page's conversation, as plain functions over injected hooks.
 *
 * It lives here rather than inside the component for the same reason the detail page's liveness
 * policy does: a decision that only ever runs in a browser cannot be specified by rendering markup,
 * and a component is a poor place to keep one. What remains in the component is state and wiring.
 */

export interface SearchHooks {
  readonly onSearching: (isSearching: boolean) => void;
  readonly onOutcome: (outcome: SearchOutcome) => void;
  readonly onFailure: (message: string) => void;
}

/**
 * What a search turned out to be. An identifier that names nothing is its OWN outcome rather than
 * an empty result set: telling someone who pasted an id to "check the spelling and paste an id" is
 * advice to do the thing they just did.
 */
export type SearchOutcome =
  | { readonly kind: 'results'; readonly results: CatalogSearchResultDto }
  | { readonly kind: 'unknown-id'; readonly mbid: string };

/**
 * A looked-up entity is presented as the only result of its kind, so one surface renders both a
 * search and a pasted identifier. `leading` is not authored here — for a lookup it is simply the
 * kind of the thing that was found, which is a fact rather than the ranking decision the downloader
 * makes for a search.
 */
export function lookupAsOutcome(found: CatalogLookupResultDto, mbid: string): SearchOutcome {
  const nothing = { releaseGroups: [], artists: [], recordings: [] };
  const one = (leading: EntityKind, results: Partial<CatalogSearchResultDto>): SearchOutcome => ({
    kind: 'results',
    results: { ...nothing, leading, ...results },
  });
  // Narrowed on the TAG, never on which fields happen to be present: the tag is what the producer
  // decided the answer is, and reading by presence would render a stray payload as a second block
  // of results under the wrong heading. Named arms rather than a default, so a fourth entity kind
  // is a compile error here rather than a lookup that silently renders as nothing.
  //
  // A tag whose payload is missing is refused by the wire schema before it reaches here, so it can
  // only arrive from a caller that built the DTO by hand — and "the answer names something we
  // cannot show" is, to a person, the same as an id that names nothing.
  switch (found.kind) {
    case 'not-found': {
      return { kind: 'unknown-id', mbid };
    }
    case 'release-group': {
      const { releaseGroup } = found;
      return releaseGroup === undefined
        ? { kind: 'unknown-id', mbid }
        : one(found.kind, { releaseGroups: [releaseGroup] });
    }
    case 'artist': {
      const { artist } = found;
      return artist === undefined
        ? { kind: 'unknown-id', mbid }
        : one(found.kind, { artists: [artist] });
    }
    case 'recording': {
      const { recording } = found;
      return recording === undefined
        ? { kind: 'unknown-id', mbid }
        : one(found.kind, { recordings: [recording] });
    }
  }
}

/**
 * Ask the catalog about what was typed. A pasted identifier names one thing and is looked up;
 * anything else is searched for. An answer that arrives after the search was abandoned is dropped
 * rather than shown, so a slow first search cannot overwrite the one that replaced it.
 */
export async function runSearch(
  catalog: CatalogClient,
  text: string,
  signal: AbortSignal,
  hooks: SearchHooks,
): Promise<void> {
  hooks.onSearching(true);
  // The two reads are awaited in their OWN branches rather than in one expression: each answer
  // then keeps its own type, so which read was made is carried by the compiler instead of by a
  // boolean and a pair of assertions that a third read, or a swap, would quietly invalidate.
  if (isCatalogId(text)) {
    const mbid = text.trim();
    const answer = await catalog.lookup(mbid, signal);
    if (signal.aborted) return;
    hooks.onSearching(false);
    if (answer.ok) hooks.onOutcome(lookupAsOutcome(answer.value, mbid));
    else hooks.onFailure(answer.message);
    return;
  }
  const answer = await catalog.search(text, signal);
  if (signal.aborted) return;
  hooks.onSearching(false);
  if (answer.ok) hooks.onOutcome({ kind: 'results', results: answer.value });
  else hooks.onFailure(answer.message);
}

/**
 * Open a result's detail view. A track needs nothing more read about it — everything shown is
 * already in hand — while an album and an artist each need one read, and either can fail.
 */
export async function openDetail(
  catalog: CatalogClient,
  kind: EntityKind,
  mbid: string,
  context: DetailContext,
  onDetail: (detail: DetailState) => void,
  isCurrent: () => boolean = () => true,
): Promise<void> {
  if (kind === 'recording') {
    onDetail({ kind: 'recording', mbid, ...context });
    return;
  }
  onDetail({ kind: 'loading', mbid, ...context });
  // Each read is awaited in its own branch, so its answer keeps its own type — see `runSearch`.
  // "Something else was opened, or everything was closed, while this was being read" is checked
  // after every await: rendering then would reopen a surface the person dismissed, or put one
  // album's editions under another's title.
  if (kind === 'release-group') {
    const answer = await catalog.editions(mbid);
    if (!isCurrent()) return;
    onDetail(
      answer.ok
        ? { kind: 'release-group', mbid, ...context, editions: answer.value }
        : { kind: 'failed', mbid, ...context, message: answer.message },
    );
    return;
  }
  const answer = await catalog.discography(mbid);
  if (!isCurrent()) return;
  onDetail(
    answer.ok
      ? { kind: 'artist', mbid, ...context, discography: answer.value }
      : { kind: 'failed', mbid, ...context, message: answer.message },
  );
}

/** Already read, or being read — either way, not something to ask for again. */
const isAlreadyRead = (state: TracklistState | undefined): boolean =>
  state?.kind === 'loading' || state?.kind === 'loaded';

/**
 * Read one edition's running order. A tracklist already read, or being read, is not asked for
 * again — the second click on a disclosure is a person changing their mind about looking, not a
 * request for fresher bytes. One that FAILED is asked for again, because the second click there is
 * exactly a request to try once more.
 */
export async function readTracklist(
  catalog: CatalogClient,
  mbid: string,
  current: Record<string, TracklistState>,
  onTracklists: (
    update: (previous: Record<string, TracklistState>) => Record<string, TracklistState>,
  ) => void,
): Promise<void> {
  if (isAlreadyRead(current[mbid])) return;
  // The decision is made against the state as it is when the write lands, not against the snapshot
  // this call started from: two clicks in the same tick would otherwise both pass a stale check and
  // read the same tracklist twice.
  const claim = { taken: false };
  onTracklists((previous) => {
    if (isAlreadyRead(previous[mbid])) return previous;
    claim.taken = true;
    return { ...previous, [mbid]: { kind: 'loading' } };
  });
  if (!claim.taken) return;
  const answer = await catalog.tracklist(mbid);
  // Written as an update over whatever is there NOW, not over the snapshot this read began with:
  // another disclosure opened meanwhile would otherwise be reverted to its earlier state.
  onTracklists((previous) => ({
    ...previous,
    [mbid]: answer.ok
      ? { kind: 'loaded', tracklist: answer.value }
      : { kind: 'failed', message: answer.message },
  }));
}
