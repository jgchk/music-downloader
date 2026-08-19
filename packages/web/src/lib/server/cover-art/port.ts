import type { ResultAsync } from 'neverthrow';

/**
 * The cover-art port: artwork for the request page's results.
 *
 * This lives in the web package on purpose. Cover art carries no meaning for the downloader — no
 * acquisition, validation, or import decision reads it — so giving that context a port for it
 * would put a picture in a bounded context that has no business with one. It is presentation, and
 * presentation is the BFF's job, alongside the Plex access port it already owns.
 *
 * The distinction the whole capability turns on: art the archive does not have is an ANSWER
 * (`absent`) that a caller may cache and render a placeholder for, while an archive that cannot be
 * reached is a FAULT — never cached, never rendered as "no cover", because tomorrow's request may
 * well find the art.
 */

/** Which catalog entity the art belongs to; both are addressable in the archive. */
export type CoverArtEntity = 'release-group' | 'release';

/** The sizes the request page asks for: a grid thumbnail and a detail-surface image. */
export type CoverArtSize = 250 | 500;

export interface CoverArtImage {
  readonly contentType: string;
  readonly bytes: Uint8Array;
}

export type CoverArtAnswer =
  { readonly kind: 'found'; readonly image: CoverArtImage } | { readonly kind: 'absent' };

/** The archive is down, erroring, or off-contract — distinct from it having no art. */
export interface CoverArtUnavailable {
  readonly kind: 'cover-art-unavailable';
  readonly detail: string;
}

export interface CoverArtPort {
  front(
    entity: CoverArtEntity,
    mbid: string,
    size: CoverArtSize,
  ): ResultAsync<CoverArtAnswer, CoverArtUnavailable>;
}
