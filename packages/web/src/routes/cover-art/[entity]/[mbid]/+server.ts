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

/** Path and query values reach the log from outside, so they arrive at a length we choose. */
const clipped = (value: string): string => value.slice(0, 64);

export const GET: RequestHandler = async ({ params, url, locals }) => {
  const { entity, mbid } = params;
  const size = sizeFrom(url.searchParams.get('size'));
  if (size === undefined || !isEntity(entity) || !isMbidShaped(mbid)) {
    // A failed cover now renders as its placeholder rather than the browser's broken-image mark,
    // so a refusal is invisible to the person looking at the page and this line is the only sign
    // of it left. `warn`, not `debug`, because debug is off in production and that is exactly
    // where every cover silently blanking would go unnoticed — but only for a request that at
    // least LOOKS like one this application builds. An identifier of no known shape is somebody
    // at the address bar; that goes to debug, so the cheapest junk cannot bury the signal. This
    // is a shape check, not a catalog lookup: a well-formed identifier for nothing in particular
    // still reaches the warn line. Both echo the path fields clipped, the values being foreign.
    const refused = {
      entity: clipped(entity),
      mbid: clipped(mbid),
      size: clipped(url.searchParams.get('size') ?? ''),
    };
    if (isMbidShaped(mbid)) {
      locals.logger.warn(refused, 'cover art refused');
    } else {
      locals.logger.debug(refused, 'cover art asked for with an identifier of no known shape');
    }
    return new Response(undefined, { status: 400 });
  }

  const answer = await locals.coverArt.front(entity, mbid, size);

  return answer.match(
    (found) => {
      if (found.kind === 'found') {
        // Double assertion, deliberately: `BodyInit` is typed over `Uint8Array<ArrayBufferLike>`
        // in this lib target while ours is `Uint8Array<ArrayBuffer>` — a lib mismatch, not a
        // mismatch of ours, and the bytes are handed on untouched.
        return new Response(found.image.bytes as unknown as BodyInit, {
          status: 200,
          headers: {
            'Content-Type': found.image.contentType,
            // `private`: the response is served from behind the access gate, so a shared cache
            // has no business holding it even though a cover is not itself a secret.
            'Cache-Control': `private, max-age=${ART_MAX_AGE_SECONDS}`,
            // Serving third-party bytes from our own origin: the declared type is the only type.
            'X-Content-Type-Options': 'nosniff',
          },
        });
      }
      // The archive listed art and none of it was a front cover: either a back-only scan, or its
      // `front` flag renamed. Indistinguishable per request, greppable in aggregate — and a rename
      // would blank every cover in the product at once while every request still answered 404.
      if (found.listedImages > 0) {
        locals.logger.debug(
          { entity, mbid, listedImages: found.listedImages },
          'cover art manifest names no front cover',
        );
      }
      return new Response(undefined, {
        status: 404,
        headers: { 'Cache-Control': `private, max-age=${ABSENCE_MAX_AGE_SECONDS}` },
      });
    },
    (failure) => {
      // The one place that knows WHY the archive failed. Unlogged, an operator sees a grid of
      // placeholders and cannot tell an outage from a shape change.
      locals.logger.warn({ entity, mbid, detail: failure.detail }, 'cover art archive unavailable');
      return new Response(undefined, { status: 502, headers: { 'Cache-Control': 'no-store' } });
    },
  );
};
