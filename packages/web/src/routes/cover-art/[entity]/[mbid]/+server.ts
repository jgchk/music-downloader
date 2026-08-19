import type { RequestHandler } from './$types';
import type { CoverArtEntity, CoverArtSize } from '$lib/server/cover-art/port.js';

/**
 * The artwork the request page's results are rendered with, served by this application rather than
 * fetched by the browser: the archive is never contacted from a viewer's machine, the bytes are
 * cached once for the whole household, and the page keeps working behind the access gate.
 *
 * The three answers are deliberately distinct to a browser. Art is cacheable for a long time,
 * because a cover does not change under its identifier. "No art" is cacheable too — otherwise every
 * placeholder in the grid would re-ask on every render — but for far less time, since the archive
 * gaining art is exactly the change worth noticing. An archive that could not be reached is never
 * cacheable: remembering it would turn a passing outage into a permanently missing cover.
 */

const ART_MAX_AGE_SECONDS = 30 * 24 * 60 * 60;
const ABSENCE_MAX_AGE_SECONDS = 60 * 60;

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const ENTITIES = new Set<string>(['release-group', 'release']);
const SIZES = new Set([250, 500]);
const DEFAULT_SIZE: CoverArtSize = 250;

function sizeFrom(value: string | null): CoverArtSize {
  const asked = Number(value);
  return SIZES.has(asked) ? (asked as CoverArtSize) : DEFAULT_SIZE;
}

export const GET: RequestHandler = async ({ params, url, locals }) => {
  const { entity, mbid } = params;
  if (!ENTITIES.has(entity) || !UUID_PATTERN.test(mbid)) {
    return new Response(undefined, { status: 400 });
  }

  const answer = await locals.coverArt.front(entity as CoverArtEntity, mbid, sizeFrom(url.searchParams.get('size')));

  return answer.match(
    (found) =>
      found.kind === 'found'
        ? new Response(found.image.bytes as unknown as BodyInit, {
            status: 200,
            headers: {
              'Content-Type': found.image.contentType,
              'Cache-Control': `public, max-age=${ART_MAX_AGE_SECONDS}, immutable`,
            },
          })
        : new Response(undefined, {
            status: 404,
            headers: { 'Cache-Control': `public, max-age=${ABSENCE_MAX_AGE_SECONDS}` },
          }),
    () =>
      new Response(undefined, {
        status: 502,
        headers: { 'Cache-Control': 'no-store' },
      }),
  );
};
