import { isCatalogId } from './view.js';
import type { CatalogClient } from './client.js';
import type { DetailState, TracklistState } from './detail.js';
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
  readonly onResults: (results: CatalogSearchResultDto) => void;
  readonly onFailure: (message: string) => void;
}

/**
 * A looked-up entity is presented as the only result of its kind, so one surface renders both a
 * search and a pasted identifier. An identifier that names nothing becomes an empty result set,
 * which that surface already knows how to say.
 */
export function lookupAsResults(found: CatalogLookupResultDto): CatalogSearchResultDto {
  return {
    leading: found.kind === 'not-found' ? 'release-group' : found.kind,
    releaseGroups: found.releaseGroup === undefined ? [] : [found.releaseGroup],
    artists: found.artist === undefined ? [] : [found.artist],
    recordings: found.recording === undefined ? [] : [found.recording],
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
  const answer = isCatalogId(text)
    ? await catalog.lookup(text.trim(), signal)
    : await catalog.search(text, signal);
  if (signal.aborted) return;
  hooks.onSearching(false);
  if (!answer.ok) {
    hooks.onFailure(answer.message);
    return;
  }
  hooks.onResults('leading' in answer.value ? answer.value : lookupAsResults(answer.value));
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
): Promise<void> {
  if (kind === 'recording') {
    onDetail({ kind: 'recording', mbid, title });
    return;
  }
  onDetail({ kind: 'loading', title });
  if (kind === 'release-group') {
    const answer = await catalog.editions(mbid);
    onDetail(
      answer.ok
        ? { kind: 'release-group', mbid, title, editions: answer.value }
        : { kind: 'failed', title, message: answer.message },
    );
    return;
  }
  const answer = await catalog.discography(mbid);
  onDetail(
    answer.ok
      ? { kind: 'artist', mbid, title, discography: answer.value }
      : { kind: 'failed', title, message: answer.message },
  );
}

/**
 * Read one edition's running order, once. A tracklist already asked for is not asked for again —
 * the second click on a disclosure is a person changing their mind about looking, not a request
 * for fresher bytes.
 */
export async function readTracklist(
  catalog: CatalogClient,
  mbid: string,
  current: Record<string, TracklistState>,
  onTracklists: (tracklists: Record<string, TracklistState>) => void,
): Promise<void> {
  if (current[mbid] !== undefined) return;
  const pending = { ...current, [mbid]: { kind: 'loading' } as TracklistState };
  onTracklists(pending);
  const answer = await catalog.tracklist(mbid);
  onTracklists({
    ...pending,
    [mbid]: answer.ok
      ? { kind: 'loaded', tracklist: answer.value }
      : { kind: 'failed', message: answer.message },
  });
}
