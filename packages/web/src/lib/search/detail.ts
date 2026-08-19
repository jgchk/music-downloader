import type {
  CatalogDiscographyResultDto,
  CatalogEditionsResultDto,
  CatalogTracklistResultDto,
} from '@music/downloader';

/**
 * The detail surface's state and the few derived strings it needs. Kept out of the component so
 * "what an edition says about itself" is testable as a sentence rather than through a rendered DOM.
 */

export type DetailState =
  | { readonly kind: 'loading'; readonly title: string }
  | { readonly kind: 'failed'; readonly title: string; readonly message: string }
  | {
      readonly kind: 'release-group';
      readonly mbid: string;
      readonly title: string;
      readonly editions: CatalogEditionsResultDto;
    }
  | {
      readonly kind: 'artist';
      readonly mbid: string;
      readonly title: string;
      readonly discography: CatalogDiscographyResultDto;
    }
  | { readonly kind: 'recording'; readonly mbid: string; readonly title: string };

/** A tracklist the person asked to see, keyed by the edition it was read from. */
export type TracklistState =
  | { readonly kind: 'loading' }
  | { readonly kind: 'failed'; readonly message: string }
  | { readonly kind: 'loaded'; readonly tracklist: CatalogTracklistResultDto };

interface EditionLike {
  readonly date?: string | undefined;
  readonly country?: string | undefined;
  readonly formats: string;
  readonly trackCount: number;
}

/**
 * What tells this pressing apart from its siblings, in the order a person scans: when, where, on
 * what, and how much of it. What the catalog does not know is simply left out — a placeholder for
 * an unknown country says less than nothing.
 */
export function editionSummary(edition: EditionLike): string {
  return [
    edition.date,
    edition.country,
    edition.formats === '' ? undefined : edition.formats,
    `${edition.trackCount} ${edition.trackCount === 1 ? 'track' : 'tracks'}`,
  ]
    .filter((part) => part !== undefined && part !== '')
    .join(' · ');
}

/** The edition the acquisition pipeline itself would choose, when it would choose one. */
export function pickedMbid(editions: CatalogEditionsResultDto): string | undefined {
  return editions.bestMatch.kind === 'pick' ? editions.bestMatch.mbid : undefined;
}

/** What the catalog knows of a release beyond its title: when, and of what kind. */
export function releaseLine(group: {
  readonly year?: number | undefined;
  readonly primaryType?: string | undefined;
}): string {
  return [group.year?.toString(), group.primaryType]
    .filter((part) => part !== undefined && part !== '')
    .join(' · ');
}

/** How one edition group heads itself: the tracklist, and how many pressings share it. */
export function groupHeading(group: {
  readonly trackCount: number;
  readonly editions: readonly unknown[];
}): string {
  const editions = group.editions.length;
  return `${group.trackCount} tracks \u{00B7} ${editions} ${editions === 1 ? 'edition' : 'editions'}`;
}

/** A running time as a sleeve prints it; nothing at all when the catalog has no timing. */
export function trackTime(durationMs: number | undefined): string {
  if (durationMs === undefined) return '';
  const totalSeconds = Math.round(durationMs / 1000);
  const seconds = totalSeconds % 60;
  return `${Math.floor(totalSeconds / 60)}:${String(seconds).padStart(2, '0')}`;
}
