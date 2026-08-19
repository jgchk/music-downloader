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
  | { readonly kind: 'loading'; readonly mbid: string; readonly title: string }
  | {
      readonly kind: 'failed';
      readonly mbid: string;
      readonly title: string;
      readonly message: string;
    }
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
  readonly formats: readonly string[];
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
    // Joined here, at the one place it is read aloud — the separator is presentation, not contract.
    edition.formats.length === 0 ? undefined : edition.formats.join(' + '),
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
  const tracks = `${group.trackCount} ${group.trackCount === 1 ? 'track' : 'tracks'}`;
  return `${tracks} \u{00B7} ${editions} ${editions === 1 ? 'edition' : 'editions'}`;
}

/** A running time as a sleeve prints it; nothing at all when the catalog has no timing. */
export function trackTime(durationMs: number | undefined): string {
  if (durationMs === undefined) return '';
  const totalSeconds = Math.round(durationMs / 1000);
  const seconds = totalSeconds % 60;
  return `${Math.floor(totalSeconds / 60)}:${String(seconds).padStart(2, '0')}`;
}

/** An edition chosen by hand, and the album it was chosen on — the pair is what keeps it honest. */
export interface EditionPin {
  readonly album: string;
  readonly edition: string;
}

/**
 * The chosen edition, but only while the album it was chosen on is the one still open. The detail
 * surface is mounted once and re-used, so a choice that remembered only an edition would survive
 * closing one album and opening another — and then quietly request the first album's pressing under
 * the second album's name.
 */
export function activeEdition(
  detail: DetailState | undefined,
  pin: EditionPin | undefined,
): string | undefined {
  if (detail?.kind !== 'release-group') return undefined;
  return pin?.album === detail.mbid ? pin.edition : undefined;
}
