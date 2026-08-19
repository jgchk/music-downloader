import type {
  CatalogDiscographyResultDto,
  CatalogEditionsResultDto,
  CatalogTracklistResultDto,
} from '@music/downloader';

/**
 * The detail view's state, the rule for which edition a choice applies to, and the derived
 * strings it reads out. Kept out of the component so "what an edition says about itself" — and
 * "whose album that choice was made on" — are testable as values rather than through a rendered DOM.
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
  readonly trackCount?: number | undefined;
}

/** How many tracks, said as a person says it — or nothing, when the catalog does not say. */
function trackCount(count: number | undefined): string | undefined {
  return count === undefined ? undefined : `${count} ${count === 1 ? 'track' : 'tracks'}`;
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
    trackCount(edition.trackCount),
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

/**
 * How one edition group heads itself: the tracklist, and how many pressings share it. The count
 * comes from the group's representative — the one edition its tracklist was read from — so the
 * heading cannot disagree with the list beneath it.
 */
export function groupHeading(group: {
  readonly representative: EditionLike;
  readonly editions: readonly unknown[];
}): string {
  const editions = group.editions.length;
  const pressings = `${editions} ${editions === 1 ? 'edition' : 'editions'}`;
  const tracks = trackCount(group.representative.trackCount);
  // An unstated count is said as such: "0 tracks" would be a falsehood about a record that has some.
  return `${tracks ?? 'Tracklist not stated'} \u{00B7} ${pressings}`;
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
 * the second album's name. Anything that is not an open album — a read still loading, one that
 * failed, an artist, a track — has no chosen edition, so re-reading the same album drops the badge
 * until its editions are back in hand.
 */
export function activeEdition(
  detail: DetailState | undefined,
  pin: EditionPin | undefined,
): string | undefined {
  if (detail?.kind !== 'release-group') return undefined;
  return pin?.album === detail.mbid ? pin.edition : undefined;
}
