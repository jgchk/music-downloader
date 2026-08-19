import { isCatalogId } from './view.js';
import type { CatalogClient } from './client.js';
import type { DetailState, TracklistState } from './detail.js';
import type { EntityKind } from './view.js';
import type {
  CatalogDiscographyResultDto,
  CatalogEditionsResultDto,
  CatalogLookupResultDto,
  CatalogSearchResultDto,
} from '@music/downloader';

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
  if (found.kind === 'not-found') return { kind: 'unknown-id', mbid };
  return {
    kind: 'results',
    results: {
      leading: found.kind,
      releaseGroups: found.releaseGroup === undefined ? [] : [found.releaseGroup],
      artists: found.artist === undefined ? [] : [found.artist],
      recordings: found.recording === undefined ? [] : [found.recording],
    },
  };
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
  // Which read was made is carried, not recovered by sniffing the answer's shape: these DTOs may
  // grow fields additively, and a lookup that happened to gain a `leading` field would otherwise
  // start rendering as a search that matched nothing.
  const mbid = text.trim();
  const isLooked = isCatalogId(text);
  const answer = isLooked ? await catalog.lookup(mbid, signal) : await catalog.search(text, signal);
  if (signal.aborted) return;
  hooks.onSearching(false);
  if (!answer.ok) {
    hooks.onFailure(answer.message);
    return;
  }
  hooks.onOutcome(
    isLooked
      ? lookupAsOutcome(answer.value as CatalogLookupResultDto, mbid)
      : { kind: 'results', results: answer.value as CatalogSearchResultDto },
  );
}

/**
 * Open a result's detail surface. A track needs nothing more read about it — everything shown is
 * already in hand — while an album and an artist each need one read, and either can fail.
 */
export async function openDetail(
  catalog: CatalogClient,
  kind: EntityKind,
  mbid: string,
  title: string,
  onDetail: (detail: DetailState) => void,
  isCurrent: () => boolean = () => true,
): Promise<void> {
  if (kind === 'recording') {
    onDetail({ kind: 'recording', mbid, title });
    return;
  }
  onDetail({ kind: 'loading', mbid, title });
  const answer =
    kind === 'release-group' ? await catalog.editions(mbid) : await catalog.discography(mbid);
  // Something else was opened, or everything was closed, while this was being read. Rendering it
  // now would reopen a surface the person dismissed, or put one album's editions under another's
  // title — so a read that lost its race says nothing at all.
  if (!isCurrent()) return;
  if (!answer.ok) {
    onDetail({ kind: 'failed', mbid, title, message: answer.message });
    return;
  }
  onDetail(
    kind === 'release-group'
      ? { kind: 'release-group', mbid, title, editions: answer.value as CatalogEditionsResultDto }
      : { kind: 'artist', mbid, title, discography: answer.value as CatalogDiscographyResultDto },
  );
}

/**
 * Read one edition's running order. A tracklist already read, or being read, is not asked for
 * again — the second click on a disclosure is a person changing their mind about looking, not a
 * request for fresher bytes. One that FAILED is asked for again, because the second click there is
 * exactly a request to try once more.
 */
/** Already read, or being read — either way, not something to ask for again. */
const isAlreadyRead = (state: TracklistState | undefined): boolean =>
  state?.kind === 'loading' || state?.kind === 'loaded';

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
