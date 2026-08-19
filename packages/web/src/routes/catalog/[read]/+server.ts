import { json } from '@sveltejs/kit';
import { messageOf, statusOf } from '$lib/server/facade-errors.js';
import type { RequestHandler } from './$types';
import type { DownloaderFacadeError } from '@music/downloader';

/**
 * The catalog reads the request page calls as a person types. One route rather than five because
 * they are one conversation — "tell me about the catalog" — differing only in which read answers;
 * splitting them would spread the same three lines of envelope handling across five files.
 *
 * These are reads behind the access gate (the open set is exact and fail-closed, so no exemption
 * is needed here). Every answer is the facade's own DTO, and every refusal keeps the facade's
 * status semantics — including the distinction the page depends on, where a catalog that could not
 * be reached is a fault rather than a search that found nothing.
 */

type FacadeResult =
  | { readonly ok: true; readonly value: unknown }
  | { readonly ok: false; readonly error: DownloaderFacadeError };

function respond(result: FacadeResult): Response {
  if (result.ok) return json(result.value);
  return json({ message: messageOf(result.error) }, { status: statusOf(result.error) });
}

export const GET: RequestHandler = async ({ params, url, locals }) => {
  const downloader = locals.facades.downloader;
  const story = locals.correlationId;
  const query = url.searchParams.get('q') ?? '';
  const mbid = url.searchParams.get('mbid') ?? '';

  switch (params.read) {
    case 'search': {
      return respond(await downloader.searchCatalog({ query }, story));
    }
    case 'lookup': {
      return respond(await downloader.lookupCatalog({ mbid }, story));
    }
    case 'discography': {
      return respond(await downloader.browseArtist({ mbid }, story));
    }
    case 'editions': {
      return respond(await downloader.listEditions({ mbid }, story));
    }
    case 'tracklist': {
      return respond(await downloader.getTracklist({ mbid }, story));
    }
    // The read name comes from the URL, so an unknown one is a request for something this
    // application does not offer — not an unhandled variant of a closed set.
    default: {
      return new Response(undefined, { status: 404 });
    }
  }
};
