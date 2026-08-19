import type {
  CatalogDiscographyResultDto,
  CatalogEditionsResultDto,
  CatalogLookupResultDto,
  CatalogSearchResultDto,
  CatalogTracklistResultDto,
} from '@music/downloader';

/**
 * The page's conversation with its own server. Failures are values here too: the page must render
 * "the catalog could not be reached" differently from "nothing matched", so a fault that arrived
 * as an exception would have to be caught and re-shaped at every call site.
 */

export type CatalogAnswer<T> =
  { readonly ok: true; readonly value: T } | { readonly ok: false; readonly message: string };

/** The message shown when the server itself could not be reached, or answered without saying why. */
const UNREACHABLE = 'The catalog could not be reached. Check the connection and try again.';

export interface CatalogClient {
  search(query: string, signal?: AbortSignal): Promise<CatalogAnswer<CatalogSearchResultDto>>;
  lookup(mbid: string, signal?: AbortSignal): Promise<CatalogAnswer<CatalogLookupResultDto>>;
  discography(
    mbid: string,
    signal?: AbortSignal,
  ): Promise<CatalogAnswer<CatalogDiscographyResultDto>>;
  editions(mbid: string, signal?: AbortSignal): Promise<CatalogAnswer<CatalogEditionsResultDto>>;
  tracklist(mbid: string, signal?: AbortSignal): Promise<CatalogAnswer<CatalogTracklistResultDto>>;
}

async function readJson(response: Response): Promise<unknown> {
  try {
    return await response.json();
  } catch {
    return undefined;
  }
}

export function httpCatalog(fetchImpl: typeof fetch = fetch): CatalogClient {
  async function read<T>(path: string, signal?: AbortSignal): Promise<CatalogAnswer<T>> {
    try {
      const response = await fetchImpl(path, { signal });
      // A body that is not JSON is not a failure of its own: the status already says what happened,
      // and an empty answer is exactly what some refusals carry.
      const body: unknown = await readJson(response);
      if (response.ok) return { ok: true, value: body as T };
      const message = (body as { message?: string } | undefined)?.message;
      return { ok: false, message: message ?? UNREACHABLE };
    } catch {
      // Including an abandoned request: the caller that abandoned it has already moved on, and a
      // page that is no longer waiting for this answer will not render the message.
      return { ok: false, message: UNREACHABLE };
    }
  }

  const byId = <T>(read_: string, mbid: string, signal?: AbortSignal): Promise<CatalogAnswer<T>> =>
    read<T>(`/catalog/${read_}?mbid=${mbid}`, signal);

  return {
    search: (query, signal) =>
      read(`/catalog/search?${new URLSearchParams({ q: query }).toString()}`, signal),
    lookup: (mbid, signal) => byId('lookup', mbid, signal),
    discography: (mbid, signal) => byId('discography', mbid, signal),
    editions: (mbid, signal) => byId('editions', mbid, signal),
    tracklist: (mbid, signal) => byId('tracklist', mbid, signal),
  };
}
