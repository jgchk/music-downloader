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

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
// `satisfies` ties each list to the union it guards: growing either union without growing its list
// stops compiling here, rather than silently 400-ing the new arm or serving the wrong size.
const ENTITIES = ['release-group', 'release'] as const satisfies readonly CoverArtEntity[];
const SIZES = [250, 500] as const satisfies readonly CoverArtSize[];
const DEFAULT_SIZE: CoverArtSize = 250;

const isEntity = (value: string): value is CoverArtEntity =>
  (ENTITIES as readonly string[]).includes(value);

function sizeFrom(value: string | null): CoverArtSize {
  const asked = Number(value);
  return (SIZES as readonly number[]).includes(asked) ? (asked as CoverArtSize) : DEFAULT_SIZE;
}

export const GET: RequestHandler = async ({ params, url, locals }) => {
  const { entity, mbid } = params;
  if (!isEntity(entity) || !UUID_PATTERN.test(mbid)) {
    return new Response(undefined, { status: 400 });
  }

  const answer = await locals.coverArt.front(entity, mbid, sizeFrom(url.searchParams.get('size')));

  return answer.match(
    (found) =>
      found.kind === 'found'
        ? new Response(found.image.bytes as unknown as BodyInit, {
            status: 200,
            headers: {
              'Content-Type': found.image.contentType,
              'Cache-Control': `public, max-age=${ART_MAX_AGE_SECONDS}`,
              // Serving third-party bytes from our own origin: the declared type is the only type.
              'X-Content-Type-Options': 'nosniff',
            },
          })
        : new Response(undefined, {
            status: 404,
            headers: { 'Cache-Control': `public, max-age=${ABSENCE_MAX_AGE_SECONDS}` },
          }),
    (failure) => {
      // The one place that knows WHY the archive failed. Unlogged, an operator sees a grid of
      // placeholders and cannot tell an outage from a shape change.
      locals.logger.warn({ entity, mbid, detail: failure.detail }, 'cover art archive unavailable');
      return new Response(undefined, { status: 502, headers: { 'Cache-Control': 'no-store' } });
    },
  );
};
