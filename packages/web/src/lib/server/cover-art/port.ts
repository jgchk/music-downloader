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
 * reached is a FAULT — never CACHED as "no cover", because tomorrow's request may well find the
 * art. (A fault does still reach the viewer as a placeholder: a cover is not load-bearing, and the
 * grid paints the same initials either way. The difference is that the fault is logged and not
 * remembered.)
 */

/** Which catalog entity the art belongs to; both are addressable in the archive. */
export type CoverArtEntity = 'release-group' | 'release';

/** The sizes the request page asks for: a grid thumbnail and a detail-view image. */
export type CoverArtSize = 250 | 500;

/**
 * The image types this application will re-serve from its own origin. A closed set rather than a
 * `string`, because the route hands this field straight to a browser as the response's own
 * `Content-Type`: `image/svg+xml` — which the archive's user-contributed content could name — is
 * a script-bearing document, and `nosniff` does not help when the declared type IS the dangerous
 * one. Making it a union puts that decision in the port every implementation must satisfy, rather
 * than in one adapter a second implementation could quietly not repeat.
 */
export type ServableImageType = 'image/jpeg' | 'image/png' | 'image/gif' | 'image/webp';

export interface CoverArtImage {
  readonly contentType: ServableImageType;
  readonly bytes: Uint8Array;
}

export type CoverArtAnswer =
  | { readonly kind: 'found'; readonly image: CoverArtImage }
  /**
   * No front cover to serve — with how many images the archive listed while saying so. A record
   * with back-only scans genuinely has none; a manifest whose `front` flag was RENAMED also has
   * none, and the two are indistinguishable per request. The count is what tells them apart in
   * aggregate, which is the difference between a diagnosable drift and a grid that quietly went
   * blank everywhere at once.
   */
  | { readonly kind: 'absent'; readonly listedImages: number };

/** The archive is down, erroring, or off-contract — distinct from it having no art. */
export interface CoverArtUnavailable {
  readonly kind: 'cover-art-unavailable';
  readonly detail: string;
  /**
   * Whose problem this is. `archive` means nobody will get an answer right now — it did not
   * respond, or it answered in a shape we cannot read. `record` means this one identifier's
   * artwork could not be served and says nothing about anyone else's.
   *
   * The distinction is the port's to draw because only the adapter knows which happened, and a
   * caller that cannot tell them apart must treat one bad record as an outage.
   */
  readonly scope: 'archive' | 'record';
}

export interface CoverArtPort {
  front(
    entity: CoverArtEntity,
    mbid: string,
    size: CoverArtSize,
  ): ResultAsync<CoverArtAnswer, CoverArtUnavailable>;
}
