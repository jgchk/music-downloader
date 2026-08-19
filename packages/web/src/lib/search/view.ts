import { isMbidShaped } from '@music/downloader/catalog-dto';
import type { qualityBucketSchema } from '@music/downloader';
import type {
  CatalogDiscographyResultDto,
  CatalogSearchResultDto,
} from '@music/downloader/catalog-dto';
import type { z } from 'zod';

/**
 * The request page's view model: which blocks of results to render, in what order, and what to
 * offer when the one being looked at is empty. Pure, so the page's presentation decisions can be
 * stated as behaviour rather than asserted through a rendered DOM.
 */

export type EntityKind = 'release-group' | 'artist' | 'recording';
export type EntityFilter = 'all' | EntityKind;

/** The reading order behind whichever kind leads: albums, then who made them, then their tracks. */
const READING_ORDER: readonly EntityKind[] = ['release-group', 'artist', 'recording'];

export function countOf(results: CatalogSearchResultDto, kind: EntityKind): number {
  switch (kind) {
    case 'release-group': {
      return results.releaseGroups.length;
    }
    case 'artist': {
      return results.artists.length;
    }
    // Named rather than defaulted: a fourth kind must break the build here, not silently report
    // the recording count under a heading of its own name.
    case 'recording': {
      return results.recordings.length;
    }
  }
}

/**
 * How many of each kind the mixed view shows. A presentation number, and web's alone: the read
 * keeps returning its full ranked lists, because the fetch depth is what gives the ranking
 * something to rank. Sized for a person scanning — albums are what most searches are for, so they
 * get the most room; artists and tracks are there to be recognized, not browsed.
 */
export const TOP_RESULTS: Record<EntityKind, number> = {
  'release-group': 10,
  artist: 6,
  recording: 6,
};

/**
 * What one kind's block actually lists. The mixed view shows the top results — past the head,
 * ranking positions are token coincidence, and a wall of them buries the kinds below and costs an
 * artwork request each. Filtering to a kind is asking to see that kind, so it shows all of it.
 */
export function topResults<T>(
  entries: readonly T[],
  kind: EntityKind,
  filter: EntityFilter,
): readonly T[] {
  return filter === 'all' ? entries.slice(0, TOP_RESULTS[kind]) : entries;
}

/** What a section heading says about its own count — and whether it is holding anything back. */
export interface ShownCount {
  readonly isTrimmed: boolean;
  readonly shown: number;
  readonly matched: number;
  /** "10 of 25" when trimmed, else the plain number. */
  readonly label: string;
}

/**
 * A count that tells the truth. A heading reading "25" above ten cards is a small lie that costs
 * someone the other fifteen; saying "10 of 25" makes the rest one interaction away instead.
 */
export function trimmedCount(matched: number, shown: number): ShownCount {
  const isTrimmed = shown < matched;

  return {
    isTrimmed,
    shown,
    matched,
    label: isTrimmed ? `${shown} of ${matched}` : String(matched),
  };
}

/**
 * An artist's releases, as the album results they are. The discography read answers a list of
 * release groups, and the grid already knows how to present those — including their artwork,
 * their request action, and the click through to an album's editions. Giving a discography a
 * presentation of its own would be a second way to show the same thing, and the panel that used
 * to do it could not show artwork at all.
 */
export function asBrowsedResults(discography: CatalogDiscographyResultDto): CatalogSearchResultDto {
  return {
    leading: 'release-group',
    releaseGroups: discography.releaseGroups,
    artists: [],
    recordings: [],
  };
}

/** Whether the catalog could not be read for this kind at all — an empty block with a reason. */
export function isUnavailable(results: CatalogSearchResultDto, kind: EntityKind): boolean {
  return (results.unavailable ?? []).some((one) => one.kind === kind);
}

const KIND_WORDS: Record<EntityKind, string> = {
  'release-group': 'albums',
  artist: 'artists',
  recording: 'tracks',
};

/**
 * What to say about the kinds a search could not be read for, or nothing when it read them all.
 *
 * Said ONCE, above the blocks, because a notice inside a block is invisible exactly when it
 * matters most: a person filtered to albums, the album read matched nothing, and the artist read
 * failed — the artists block is not on screen to carry the news, and the page would otherwise tell
 * them to check their spelling.
 *
 * The two reasons get different words on purpose. A catalog that could not be REACHED may answer
 * on a retry; one whose answer could not be READ has changed shape, and no amount of retrying by
 * this person will fix it.
 */
export function unavailableNotice(results: CatalogSearchResultDto): string | undefined {
  const unavailable = results.unavailable ?? [];
  if (unavailable.length === 0) return undefined;
  const words = unavailable.map((one) => KIND_WORDS[one.kind]).join(' and ');
  return unavailable.every((one) => one.reason === 'unreadable')
    ? `The catalog answered about ${words} in a way this page could not read. That is a bug, not your search.`
    : `The catalog could not be reached for ${words}. Anything else it answered is below.`;
}

/**
 * The blocks to render, in order. The catalog decides which kind leads — it is the one that read
 * the query — and the rest follow in reading order. A kind that matched nothing is left out
 * entirely rather than heading an empty section — UNLESS it is empty because the catalog could not
 * be read for it, which is a different fact and one worth a heading of its own to say.
 */
export function orderedKinds(
  results: CatalogSearchResultDto,
  filter: EntityFilter,
): readonly EntityKind[] {
  const kinds =
    filter === 'all'
      ? [results.leading, ...READING_ORDER.filter((kind) => kind !== results.leading)]
      : [filter];
  return kinds.filter((kind) => countOf(results, kind) > 0 || isUnavailable(results, kind));
}

/**
 * Where else the query did match, for a filtered view that came up empty — the one-interaction way
 * out of a dead end. While looking at everything there is nowhere else to look, so it names none.
 */
export interface OtherMatch {
  readonly kind: EntityKind;
  readonly count: number;
  /** The word that joins this one to what came before it — empty for the first. */
  readonly joiner: string;
}

export function otherMatches(
  results: CatalogSearchResultDto,
  filter: EntityFilter,
): readonly OtherMatch[] {
  if (filter === 'all') return [];
  return READING_ORDER.filter((kind) => kind !== filter)
    .map((kind) => ({ kind, count: countOf(results, kind) }))
    .filter((other) => other.count > 0)
    .map((other, index) => ({ ...other, joiner: index === 0 ? '' : ' and ' }));
}

/**
 * What stands in for a cover the archive has not got — the subject's leading initials. Shared by
 * every artwork slot (grid card, artist bubble, row thumbnail, detail panel), so a cover that is
 * missing looks the same wherever it goes missing.
 */
export function initialsOf(title: string): string {
  const initials = title
    .split(/\s+/)
    .slice(0, 2)
    .map((word) => word.charAt(0).toUpperCase())
    .join('');

  // A title of nothing but spaces would otherwise render the empty grey box the placeholder
  // exists to prevent — so the slot falls back to saying "some record", not nothing.
  return initials === '' ? '♪' : initials;
}

/**
 * The one line under a result's title. Built here rather than in the template because a template
 * that concatenates values has to answer what an absent one renders as, and the answer belongs
 * with the rule ("say nothing about what the catalog does not know"), not with the markup.
 */
export function albumDetail(group: {
  readonly artistCredit: string;
  readonly year?: number | undefined;
}): string {
  return [group.artistCredit, group.year?.toString()]
    .filter((part) => part !== undefined && part !== '')
    .join(' · ');
}

export function trackDetail(recording: {
  readonly artistCredit: string;
  readonly release?: { readonly title: string } | undefined;
}): string {
  return [recording.artistCredit, recording.release?.title]
    .filter((part) => part !== undefined && part !== '')
    .join(' · ');
}

/**
 * Where this application serves a catalog entity's artwork from, at the size being rendered. The
 * entity union is spelt out rather than imported from the cover-art port: this module runs in the
 * browser, and SvelteKit forbids client code importing `$lib/server`. The route's own `satisfies`
 * guard is what makes growing that union a build error there; if it ever grows, this list has to
 * be grown by hand to match.
 */
export function artUrl(entity: 'release-group' | 'release', mbid: string, size: 250 | 500): string {
  return `/cover-art/${entity}/${mbid}?size=${size}`;
}

/** Plain names for the copy, singular and plural — a count of one must not read "1 albums". */
const PLAIN_NAMES: Record<EntityKind, { readonly one: string; readonly many: string }> = {
  'release-group': { one: 'album', many: 'albums' },
  artist: { one: 'artist', many: 'artists' },
  recording: { one: 'track', many: 'tracks' },
};

const plainName = (kind: EntityKind, count: number): string =>
  count === 1 ? PLAIN_NAMES[kind].one : PLAIN_NAMES[kind].many;

/**
 * What an empty view says before it lists where the query did match. Takes the alternatives rather
 * than a flag, so `filter` narrows to a kind that has a name — `all` has none, and asking for one
 * would render "No undefined matched".
 */
export function emptyLead(
  filter: EntityFilter,
  query: string,
  elsewhere: readonly OtherMatch[],
): string {
  if (filter === 'all' || elsewhere.length === 0) {
    return `Nothing matched \u{201C}${query}\u{201D}. Check the spelling, try fewer words, or paste a MusicBrainz ID.`;
  }
  return `No ${PLAIN_NAMES[filter].many} matched \u{201C}${query}\u{201D} \u{2014} but`;
}

/** How one alternative reads: "3 artists", or "1 album", joined to what came before it. */
export function alternativeLabel(other: OtherMatch): string {
  return `${other.count} ${plainName(other.kind, other.count)}`;
}

/**
 * Every quality floor a request may name, keyed by the wire union so a new tier is a build error
 * here — MINUS `UNKNOWN`, which is what the classifier emits when it cannot tell what a file is,
 * not a standard anyone would ask a download to meet. The options themselves are written out in `QualityFloorSelect.svelte` (the compiler emits
 * an unreachable nullish guard around an interpolated `<option>`), and the two are held together
 * by a test that asserts the rendered values are exactly these keys — which is what stops a tier
 * from quietly missing from the form, the way `LOSSY_LOW` once did.
 */
export const QUALITY_FLOORS: Record<
  Exclude<z.infer<typeof qualityBucketSchema>, 'UNKNOWN'>,
  string
> = {
  LOSSLESS_HIRES: 'Hi-res lossless',
  LOSSLESS: 'Lossless',
  LOSSY_HIGH: 'High quality lossy',
  LOSSY_STANDARD: 'Standard lossy',
  LOSSY_LOW: 'Low quality lossy',
};

/** Whether what was typed is a catalog identifier rather than something to search for. */
export function isCatalogId(text: string): boolean {
  // The rule belongs to the context that mints these identifiers; asked for rather than re-spelt.
  return isMbidShaped(text);
}
