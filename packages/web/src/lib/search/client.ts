import {
  catalogDiscographyResultSchema,
  catalogEditionsResultSchema,
  catalogLookupResultSchema,
  catalogSearchResultSchema,
  catalogTracklistResultSchema,
} from '@music/downloader';
import type { ZodType } from 'zod';
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
export const UNREACHABLE = 'The catalog could not be reached. Check the connection and try again.';

/** Shown when an answer arrives that this page cannot read — most often an expired session. */
export const UNREADABLE =
  'That answer could not be read. Reload the page, and sign in again if asked.';

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

/** Whether a body could be read at all, as a value — an absent body and an unreadable one differ. */
type JsonBody = { readonly parsed: true; readonly value: unknown } | { readonly parsed: false };

async function readJson(response: Response): Promise<JsonBody> {
  try {
    return { parsed: true, value: await response.json() };
  } catch {
    return { parsed: false };
  }
}

export function httpCatalog(fetchImpl: typeof fetch = fetch): CatalogClient {
  async function read<T>(
    path: string,
    schema: ZodType<T>,
    signal?: AbortSignal,
  ): Promise<CatalogAnswer<T>> {
    try {
      const response = await fetchImpl(path, { signal });
      const body = await readJson(response);
      if (response.ok) {
        // An answer that cannot be read is not an answer, however successful its status. A session
        // that expired while this page was open redirects to the sign-in page, which arrives here
        // as perfectly ordinary 200 HTML — reporting that as a successful search would tell someone
        // who is merely signed out that nothing matched.
        if (!body.parsed) return { ok: false, message: UNREADABLE };
        // The wire shape is checked HERE, not assumed. The server's own tests prove what it sends;
        // this proves what arrived is that — a stale deploy, a proxy, or a different route matching
        // would otherwise reach the page as a result object whose fields are quietly absent.
        const shaped = schema.safeParse(body.value);
        return shaped.success
          ? { ok: true, value: shaped.data }
          : { ok: false, message: UNREADABLE };
      }
      // A refusal that carries no readable body is normal: its status already said what happened.
      const message = body.parsed
        ? (body.value as { message?: string } | null)?.message
        : undefined;
      return { ok: false, message: message ?? UNREACHABLE };
    } catch {
      // Including an abandoned request: the caller that abandoned it has already moved on, and a
      // page that is no longer waiting for this answer will not render the message.
      return { ok: false, message: UNREACHABLE };
    }
  }

  const byId = <T>(
    read_: string,
    schema: ZodType<T>,
    mbid: string,
    signal?: AbortSignal,
  ): Promise<CatalogAnswer<T>> => read<T>(`/catalog/${read_}?mbid=${mbid}`, schema, signal);

  return {
    search: (query, signal) =>
      read(
        `/catalog/search?${new URLSearchParams({ q: query }).toString()}`,
        catalogSearchResultSchema,
        signal,
      ),
    lookup: (mbid, signal) => byId('lookup', catalogLookupResultSchema, mbid, signal),
    discography: (mbid, signal) =>
      byId('discography', catalogDiscographyResultSchema, mbid, signal),
    editions: (mbid, signal) => byId('editions', catalogEditionsResultSchema, mbid, signal),
    tracklist: (mbid, signal) => byId('tracklist', catalogTracklistResultSchema, mbid, signal),
  };
}
