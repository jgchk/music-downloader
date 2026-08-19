import {
  catalogDiscographyResultSchema,
  catalogEditionsResultSchema,
  catalogLookupResultSchema,
  catalogSearchResultSchema,
  catalogTracklistResultSchema,
} from '@music/downloader/catalog-dto';
import { z } from 'zod';
import type { ZodType } from 'zod';
import type {
  CatalogDiscographyResultDto,
  CatalogEditionsResultDto,
  CatalogLookupResultDto,
  CatalogSearchResultDto,
  CatalogTracklistResultDto,
} from '@music/downloader/catalog-dto';

/**
 * The page's conversation with its own server. Failures are values here too: the page must render
 * "the catalog could not be reached" differently from "nothing matched", so a fault that arrived
 * as an exception would have to be caught and re-shaped at every call site.
 */

export type CatalogAnswer<T> =
  { readonly ok: true; readonly value: T } | { readonly ok: false; readonly message: string };

/** The message shown when the server itself could not be reached, or answered without saying why. */
export const UNREACHABLE = 'The catalog could not be reached. Check the connection and try again.';

/** Shown when an answer arrives that is not JSON at all — most often an expired session. */
export const UNREADABLE =
  'That answer could not be read. Reload the page, and sign in again if asked.';

/**
 * Shown when the answer IS this application's, and its shape is not the one this page knows.
 * Kept apart from {@link UNREADABLE} on purpose: telling someone to sign in again cannot possibly
 * help with a producer and consumer that disagree, and they would go and do it.
 */
/** Shown when the page's own conversation with the catalog broke in a way it does not model. */
export const UNEXPECTED =
  'Something went wrong on this page. Reload it — if it keeps happening, this is a bug.';

export const MALFORMED =
  'That answer could not be understood. Reload the page — if it keeps happening, this is a bug.';

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

export interface CatalogClientConfig {
  /** How long to wait for an answer. A seam so a test need not wait out a real deadline. */
  readonly timeoutMs?: number;
}

/**
 * How long the page waits for its own server before calling it unreachable. A connection that is
 * accepted and never answered would otherwise leave the search spinning forever, which is the
 * least actionable state there is — a person cannot tell it from a slow catalog.
 */
const REQUEST_TIMEOUT_MS = 15_000;

/** Whether a body could be read at all, as a value — an absent body and an unreadable one differ. */
type JsonBody = { readonly parsed: true; readonly value: unknown } | { readonly parsed: false };

async function readJson(response: Response): Promise<JsonBody> {
  try {
    return { parsed: true, value: await response.json() };
  } catch {
    return { parsed: false };
  }
}

/** Whether the request itself completed — the one throwing surface here belongs to the platform. */
type Attempt = { readonly sent: true; readonly response: Response } | { readonly sent: false };

async function send(fetchImpl: typeof fetch, path: string, signal: AbortSignal): Promise<Attempt> {
  try {
    return { sent: true, response: await fetchImpl(path, { signal }) };
  } catch {
    // Including an abandoned request: the caller that abandoned it has already moved on, and a
    // page that is no longer waiting for this answer will not render the message.
    return { sent: false };
  }
}

/** The refusal a server sent, if it sent one a person can act on. */
const refusalSchema = z.object({ message: z.string() });

export function httpCatalog(
  fetchImpl: typeof fetch = fetch,
  config: CatalogClientConfig = {},
): CatalogClient {
  const timeoutMs = config.timeoutMs ?? REQUEST_TIMEOUT_MS;
  async function read<T>(
    path: string,
    schema: ZodType<T>,
    signal?: AbortSignal,
  ): Promise<CatalogAnswer<T>> {
    // A deadline of our own, combined with the caller's abandon signal: without it a server that
    // accepts the connection and never answers leaves the page waiting forever.
    const deadline = AbortSignal.timeout(timeoutMs);
    const attempt = await send(
      fetchImpl,
      path,
      signal === undefined ? deadline : AbortSignal.any([signal, deadline]),
    );
    // Everything below runs OUTSIDE that catch: only `fetch` may throw here, and a first-party bug
    // reported as "check your connection" would send a person to look at their wifi.
    if (!attempt.sent) return { ok: false, message: UNREACHABLE };
    const { response } = attempt;
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
      if (shaped.success) return { ok: true, value: shaped.data };
      // A 200 whose JSON this page cannot read is this application disagreeing with itself. The
      // server logged nothing — to it the read succeeded — so the console is the only place the
      // evidence can live.
      console.error('catalog answer did not match the expected shape', path, shaped.error.issues);
      return { ok: false, message: MALFORMED };
    }
    // A refusal that carries no readable body is normal: its status already said what happened.
    // What it DOES carry is parsed rather than trusted — the words are rendered to a person, and
    // a proxy's non-string `message` would otherwise reach them as "[object Object]".
    const refusal = body.parsed ? refusalSchema.safeParse(body.value) : undefined;
    return { ok: false, message: refusal?.success === true ? refusal.data.message : UNREACHABLE };
  }

  const byId = <T>(
    read_: string,
    schema: ZodType<T>,
    mbid: string,
    signal?: AbortSignal,
  ): Promise<CatalogAnswer<T>> =>
    // Encoded rather than interpolated: the DTOs type an identifier as a string, and this page
    // does not get to assume every string it is handed is URL-shaped.
    read<T>(`/catalog/${read_}?${new URLSearchParams({ mbid }).toString()}`, schema, signal);

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
