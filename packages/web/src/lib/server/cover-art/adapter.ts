import { ResultAsync, err, ok } from 'neverthrow';
import { coverArtManifestSchema } from './schemas.js';
import type { Result } from 'neverthrow';
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
 */

const USER_AGENT = 'music-downloader/1.0 (https://github.com/jgchk/music-downloader)';
const DEFAULT_BASE_URL = 'https://coverartarchive.org';
const DEFAULT_CONTENT_TYPE = 'image/jpeg';

function unavailable(detail: string): CoverArtUnavailable {
  return { kind: 'cover-art-unavailable', detail };
}

export interface CoverArtConfig {
  readonly baseUrl?: string;
}

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
    return ResultAsync.fromPromise(this.read(entity, mbid, size), (cause) =>
      unavailable(`the cover art archive could not be reached: ${String(cause)}`),
    ).andThen((answer) => answer);
  }

  /**
   * Resolved as a `Result` rather than by throwing: the promise's own rejection channel is
   * reserved for the fetch call itself, which is the one throwing surface here.
   */
  private async read(
    entity: CoverArtEntity,
    mbid: string,
    size: CoverArtSize,
  ): Promise<Result<CoverArtAnswer, CoverArtUnavailable>> {
    const response = await this.fetchImpl(`${this.baseUrl}/${entity}/${mbid}`, {
      headers: { Accept: 'application/json', 'User-Agent': USER_AGENT },
    });
    // The archive saying it holds no art for this thing is an answer a caller may remember.
    if (response.status === 404) return ok({ kind: 'absent' });
    if (!response.ok) {
      return err(unavailable(`the cover art archive responded ${response.status}`));
    }

    const parsed = coverArtManifestSchema.safeParse(await response.json());
    if (!parsed.success) return err(unavailable('the cover art archive’s shape has drifted'));

    const front = (parsed.data.images ?? []).find((candidate) => candidate.front === true);
    const source = front?.thumbnails?.[String(size) as '250' | '500'] ?? front?.image;
    // Art that exists but has no front cover is, for a picker, no art at all.
    if (source === undefined) return ok({ kind: 'absent' });

    const image = await this.fetchImpl(source, { headers: { 'User-Agent': USER_AGENT } });
    if (!image.ok) {
      // The manifest promised an image the archive would not serve. That is the archive failing,
      // not the record lacking art — remembering it as absence would hide the art for good.
      return err(unavailable(`the cover art archive served ${image.status} for its own image`));
    }
    return ok({
      kind: 'found',
      image: {
        contentType: image.headers.get('content-type') ?? DEFAULT_CONTENT_TYPE,
        bytes: new Uint8Array(await image.arrayBuffer()),
      },
    });
  }
}
