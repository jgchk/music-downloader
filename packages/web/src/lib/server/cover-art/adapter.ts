import { ResultAsync, errAsync, okAsync } from 'neverthrow';
import { coverArtManifestSchema } from './schemas.js';
import type { CoverArtManifest } from './schemas.js';
import type {
  CoverArtAnswer,
  CoverArtEntity,
  CoverArtPort,
  CoverArtSize,
  CoverArtUnavailable,
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
const DEFAULT_CONTENT_TYPE = 'image/jpeg';
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
/** Only an image may be re-served as one; anything else is served as the default rather than echoed. */
const IMAGE_CONTENT_TYPE_PREFIX = 'image/';

function unavailable(detail: string): CoverArtUnavailable {
  return { kind: 'cover-art-unavailable', detail };
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
      if (answer.kind === 'absent') return okAsync<CoverArtAnswer>({ kind: 'absent' });
      const front = (answer.manifest.images ?? []).find((image) => image.front === true);
      const source = front?.thumbnails?.[String(size) as '250' | '500'] ?? front?.image;
      // Art that exists but has no front cover is, for a picker, no art at all.
      if (source === undefined) return okAsync<CoverArtAnswer>({ kind: 'absent' });
      const url = imageUrl(source);
      if (url === undefined) {
        return errAsync<CoverArtAnswer, CoverArtUnavailable>(
          unavailable('the cover art archive named an image somewhere we will not fetch from'),
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
      (cause) => unavailable(`the cover art archive could not be reached: ${String(cause)}`),
    ).andThen((response) => {
      // The archive saying it holds no art for this thing is an answer a caller may remember.
      if (response.status === 404) return okAsync<ManifestAnswer>({ kind: 'absent' });
      if (!response.ok) {
        return errAsync<ManifestAnswer, CoverArtUnavailable>(
          unavailable(`the cover art archive responded ${response.status}`),
        );
      }
      return ResultAsync.fromPromise(response.json(), () =>
        unavailable('the cover art archive answered with something other than JSON'),
      ).andThen((json) => {
        const parsed = coverArtManifestSchema.safeParse(json);
        return parsed.success
          ? okAsync<ManifestAnswer>({ kind: 'manifest', manifest: parsed.data })
          : errAsync<ManifestAnswer, CoverArtUnavailable>(
              unavailable('the cover art archive’s shape has drifted'),
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
      (cause) => unavailable(`the cover art image could not be fetched: ${String(cause)}`),
    ).andThen((image) => {
      if (!image.ok) {
        // The manifest promised an image the archive would not serve. That is the archive failing,
        // not the record lacking art — remembering it as absence would hide the art for good.
        return errAsync<CoverArtAnswer, CoverArtUnavailable>(
          unavailable(`the cover art archive served ${image.status} for its own image`),
        );
      }
      return ResultAsync.fromPromise(image.arrayBuffer(), () =>
        unavailable('the cover art image could not be read to the end'),
      ).map((bytes) => {
        // Re-served from our own origin, so only an image type is echoed; anything else would let
        // the archive choose how this application's responses are interpreted.
        const declared = image.headers.get('content-type') ?? '';
        return {
          kind: 'found' as const,
          image: {
            contentType: declared.startsWith(IMAGE_CONTENT_TYPE_PREFIX)
              ? declared
              : DEFAULT_CONTENT_TYPE,
            bytes: new Uint8Array(bytes),
          },
        };
      });
    });
  }
}
