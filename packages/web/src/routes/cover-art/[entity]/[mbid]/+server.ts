import { isMbidShaped } from '@music/downloader/catalog-dto';
import type { RequestHandler } from './$types';
import type { CoverArtEntity, CoverArtSize } from '$lib/server/cover-art/port.js';

/**
 * The artwork the request page's results are rendered with, served by this application rather than
 * fetched by the browser: the archive is never contacted from a viewer's machine, the bytes are
 * cached once for the whole household, and the page keeps working behind the access gate.
 *
 * The three answers are deliberately distinct to a browser. Art is cacheable for a long time,
 * because a cover changes rarely enough that the staleness is worth the quiet — but not `immutable`,
 * since a contributor CAN replace the front cover under an unchanged identifier and a reload should
 * be able to find it. "No art" is cacheable too — otherwise every placeholder in the grid would
 * re-ask on every render — but for far less time, since the archive gaining art is exactly the
 * change worth noticing. An archive that could not be reached is never cacheable: remembering it
 * would turn a passing outage into a permanently missing cover.
 */

const ART_MAX_AGE_SECONDS = 30 * 24 * 60 * 60;
const ABSENCE_MAX_AGE_SECONDS = 60 * 60;

// `satisfies` ties each list to the union it guards: growing either union without growing its list
// stops compiling here, rather than silently 400-ing the new arm or serving the wrong size.
const ENTITIES = ['release-group', 'release'] as const satisfies readonly CoverArtEntity[];
const SIZES = [250, 500] as const satisfies readonly CoverArtSize[];
const DEFAULT_SIZE: CoverArtSize = 250;

const isEntity = (value: string): value is CoverArtEntity =>
  (ENTITIES as readonly string[]).includes(value);

/**
 * The size asked for, or nothing when the request named a size this route does not serve. Refused
 * rather than quietly downgraded: silently serving a 250px image to a request for 1000 hands the
 * caller a blurry cover and no way to learn why.
 */
function sizeFrom(value: string | null): CoverArtSize | undefined {
  if (value === null) return DEFAULT_SIZE;
  const asked = Number(value);
  return (SIZES as readonly number[]).includes(asked) ? (asked as CoverArtSize) : undefined;
}

export const GET: RequestHandler = async ({ params, url, locals }) => {
  const { entity, mbid } = params;
  const size = sizeFrom(url.searchParams.get('size'));
  if (size === undefined || !isEntity(entity) || !isMbidShaped(mbid)) {
    // A page emitting art URLs this route refuses would show a grid of placeholders and say
    // nothing at all; at debug, the wall of 400s is at least greppable.
    locals.logger.debug({ entity, mbid, size: url.searchParams.get('size') }, 'cover art refused');
    return new Response(undefined, { status: 400 });
  }

  const answer = await locals.coverArt.front(entity, mbid, size);

  return answer.match(
    (found) =>
      found.kind === 'found'
        ? new Response(found.image.bytes as unknown as BodyInit, {
            status: 200,
            headers: {
              'Content-Type': found.image.contentType,
              // `private`: the response is served from behind the access gate, so a shared cache
              // has no business holding it even though a cover is not itself a secret.
              'Cache-Control': `private, max-age=${ART_MAX_AGE_SECONDS}`,
              // Serving third-party bytes from our own origin: the declared type is the only type.
              'X-Content-Type-Options': 'nosniff',
            },
          })
        : new Response(undefined, {
            status: 404,
            headers: { 'Cache-Control': `private, max-age=${ABSENCE_MAX_AGE_SECONDS}` },
          }),
    (failure) => {
      // The one place that knows WHY the archive failed. Unlogged, an operator sees a grid of
      // placeholders and cannot tell an outage from a shape change.
      locals.logger.warn({ entity, mbid, detail: failure.detail }, 'cover art archive unavailable');
      return new Response(undefined, { status: 502, headers: { 'Cache-Control': 'no-store' } });
    },
  );
};
