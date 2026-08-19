import { ResultAsync, errAsync, okAsync } from 'neverthrow';
import { coverArtManifestSchema } from './schemas.js';
import type { CoverArtManifest } from './schemas.js';
import type {
  CoverArtAnswer,
  CoverArtEntity,
  CoverArtPort,
  CoverArtSize,
  CoverArtUnavailable,
  ServableImageType,
} from './port.js';

/**
 * The Cover Art Archive adapter behind {@link CoverArtPort}: the manifest is read and validated
 * against the contract schema, then the chosen image is fetched as opaque bytes and handed back
 * for the endpoint to serve.
 *
 * Reading the manifest first rather than the archive's redirecting `/front-250` shortcut is what
 * makes this contract-testable: the manifest has a shape a schema can hold the archive to, where
 * the shortcut's answer is a redirect to bytes. The cost is one extra upstream read per cover the
 * cache does not already hold, which the cache in front of this port makes rare.
 *
 * Every throwing surface here belongs to the vendor — `fetch`, `Response#json`, `Response#arrayBuffer`
 * — and each is converted to a value at its own call site, so no rejection ever travels through
 * first-party branching. Each conversion names its own step, so "the archive is unreachable" is
 * never reported for an image body that simply truncated.
 */

/** The same identity the catalog adapter presents; both providers ask to be able to contact us. */
const USER_AGENT = 'music-downloader/0.0 (https://github.com/anthropics/music-downloader)';
const DEFAULT_BASE_URL = 'https://coverartarchive.org';
const DEFAULT_CONTENT_TYPE: ServableImageType = 'image/jpeg';
/**
 * Finite, because the archive is volunteer-run and does black-hole connections. An unbounded fetch
 * here would hold a request — and its handle — open for as long as the far end stays silent, one
 * per tile in a grid. The abort arrives as an unavailability, which is exactly what it is, and is
 * therefore never cached.
 */
const REQUEST_TIMEOUT_MS = 10_000;
/**
 * The hosts an image may be fetched from. The second hop's URL is chosen by the FIRST hop's
 * response, so it is untrusted input: without this, a compromised or drifted manifest could point
 * this server at any address it liked, and we would re-serve whatever came back from our own origin.
 */
const IMAGE_HOSTS = new Set(['coverartarchive.org', 'archive.org']);
/**
 * The types that may be echoed back. Not a prefix test: `image/svg+xml` starts with `image/` and is
 * a script-bearing document served from our own origin. Anything else — including an SVG, and
 * including a type the archive invents — is served as the default rather than echoed.
 */
const SERVABLE_IMAGE_TYPES = new Set([
  'image/jpeg',
  'image/png',
  'image/gif',
  'image/webp',
] as const satisfies readonly ServableImageType[]);

/** The declared type if we are willing to serve it under our own origin, else the default. */
function servableType(declared: string): ServableImageType {
  // The parameters (`; charset=…`) are the archive's to send and not ours to echo.
  const media = declared.replace(/;.*$/, '').trim().toLowerCase();
  // `has` narrows against the set's own element type, so nothing is asserted back into the union.
  return SERVABLE_IMAGE_TYPES.has(media as ServableImageType)
    ? (media as ServableImageType)
    : DEFAULT_CONTENT_TYPE;
}

/**
 * Which thumbnail key each size we serve is named by in the manifest. A map rather than a cast of
 * the number: growing {@link CoverArtSize} then fails to compile here instead of silently falling
 * through to the full-size image.
 */
const THUMBNAIL_KEYS: Record<CoverArtSize, '250' | '500'> = { 250: '250', 500: '500' };

/** Whether a refused status is the archive's word about itself rather than about one record. */
const isAboutTheArchive = (status: number): boolean =>
  status >= 500 || status === 429 || status === 408 || status === 403;

function unavailable(detail: string, scope: CoverArtUnavailable['scope']): CoverArtUnavailable {
  return { kind: 'cover-art-unavailable', detail, scope };
}

/**
 * The manifest's image URL, over https, from a host the archive actually serves from. The archive
 * still hands out `http://` links, so the scheme is upgraded rather than refused.
 */
function imageUrl(source: string): URL | undefined {
  const parsed = URL.parse(source);
  if (parsed === null) return undefined;
  if (parsed.protocol === 'http:') parsed.protocol = 'https:';
  if (parsed.protocol !== 'https:') return undefined;
  // The archive serves images from its own host and from the archive.org storage nodes it fronts,
  // so a subdomain of either is accepted and anything else is not.
  const isAllowed = [...IMAGE_HOSTS].some(
    (host) => parsed.hostname === host || parsed.hostname.endsWith(`.${host}`),
  );
  return isAllowed ? parsed : undefined;
}

export interface CoverArtConfig {
  readonly baseUrl?: string;
}

/** What the archive says it holds for one entity: a manifest to read, or nothing at all. */
type ManifestAnswer =
  { readonly kind: 'manifest'; readonly manifest: CoverArtManifest } | { readonly kind: 'absent' };

export class CoverArtArchive implements CoverArtPort {
  private readonly baseUrl: string;

  constructor(
    config: CoverArtConfig = {},
    private readonly fetchImpl: typeof fetch = fetch,
  ) {
    this.baseUrl = config.baseUrl ?? DEFAULT_BASE_URL;
  }

  front(
    entity: CoverArtEntity,
    mbid: string,
    size: CoverArtSize,
  ): ResultAsync<CoverArtAnswer, CoverArtUnavailable> {
    return this.manifest(entity, mbid).andThen((answer) => {
      if (answer.kind === 'absent')
        return okAsync<CoverArtAnswer>({ kind: 'absent', listedImages: 0 });
      const images = answer.manifest.images ?? [];
      const front = images.find((image) => image.front === true);
      // Art that exists but has no front cover is, for a picker, no art at all — said WITH how
      // many images were listed, because "back-only scans" and "the `front` flag was renamed"
      // look identical here and only the count can tell them apart later.
      if (front === undefined) {
        return okAsync<CoverArtAnswer>({ kind: 'absent', listedImages: images.length });
      }
      const source = front.thumbnails?.[THUMBNAIL_KEYS[size]] ?? front.image;
      if (source === undefined) {
        // A front cover that names no image at all is the archive off-contract — a renamed field,
        // most likely. Reported as absence it would be remembered for a day and served to the
        // browser as a 404, blanking every cover in the grid with nothing said anywhere.
        return errAsync<CoverArtAnswer, CoverArtUnavailable>(
          unavailable(
            'the cover art archive listed a front cover with no image to fetch',
            'record',
          ),
        );
      }
      const url = imageUrl(source);
      if (url === undefined) {
        return errAsync<CoverArtAnswer, CoverArtUnavailable>(
          unavailable(
            'the cover art archive named an image somewhere we will not fetch from',
            'record',
          ),
        );
      }
      return this.image(url);
    });
  }

  private manifest(
    entity: CoverArtEntity,
    mbid: string,
  ): ResultAsync<ManifestAnswer, CoverArtUnavailable> {
    return ResultAsync.fromPromise(
      this.fetchImpl(`${this.baseUrl}/${entity}/${mbid}`, {
        headers: { Accept: 'application/json', 'User-Agent': USER_AGENT },
        signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
      }),
      (cause) =>
        unavailable(`the cover art archive could not be reached: ${String(cause)}`, 'archive'),
    ).andThen((response) => {
      // The archive saying it holds no art for this thing is an answer a caller may remember.
      if (response.status === 404) return okAsync<ManifestAnswer>({ kind: 'absent' });
      if (!response.ok) {
        // A refusal in the 4xx range is about the thing we asked for; a 5xx is the archive
        // itself. Only the second is a reason to stop asking on everyone else's behalf.
        return errAsync<ManifestAnswer, CoverArtUnavailable>(
          unavailable(
            `the cover art archive responded ${response.status}`,
            // A 4xx is usually about the thing we asked for. The exceptions are the provider
            // talking about ITSELF — asking for less (429), asking for the same again (408), or
            // refusing us outright (403) — and answering those with 25 more requests makes the
            // situation worse for every tile on the page.
            isAboutTheArchive(response.status) ? 'archive' : 'record',
          ),
        );
      }
      return ResultAsync.fromPromise(response.json(), () =>
        unavailable('the cover art archive answered with something other than JSON', 'archive'),
      ).andThen((json) => {
        const parsed = coverArtManifestSchema.safeParse(json);
        return parsed.success
          ? okAsync<ManifestAnswer>({ kind: 'manifest', manifest: parsed.data })
          : errAsync<ManifestAnswer, CoverArtUnavailable>(
              unavailable('the cover art archive’s shape has drifted', 'archive'),
            );
      });
    });
  }

  private image(source: URL): ResultAsync<CoverArtAnswer, CoverArtUnavailable> {
    return ResultAsync.fromPromise(
      this.fetchImpl(source.href, {
        headers: { 'User-Agent': USER_AGENT },
        signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
      }),
      // The image lives on a different host from the manifest (archive.org storage), which goes
      // down on its own — so a transport failure here is an archive being unreachable, not this
      // record lacking art.
      (cause) =>
        unavailable(`the cover art image could not be fetched: ${String(cause)}`, 'archive'),
    ).andThen((image) => {
      if (!image.ok) {
        // The manifest promised an image that did not arrive. Never remembered as absence —
        // that would hide the art for good — and the same split as the manifest: a host saying
        // it is down, or asking for less, is about the archive; a 404 on one image is not.
        return errAsync<CoverArtAnswer, CoverArtUnavailable>(
          unavailable(
            `the cover art archive served ${image.status} for its own image`,
            isAboutTheArchive(image.status) ? 'archive' : 'record',
          ),
        );
      }
      return ResultAsync.fromPromise(image.arrayBuffer(), () =>
        unavailable('the cover art image could not be read to the end', 'record'),
      ).map((bytes) => {
        // Re-served from our own origin, so only a type we are willing to serve is echoed;
        // anything else would let the archive choose how our responses are interpreted.
        return {
          kind: 'found' as const,
          image: {
            contentType: servableType(image.headers.get('content-type') ?? ''),
            bytes: new Uint8Array(bytes),
          },
        };
      });
    });
  }
}
