import type { qualityBucketSchema } from '@music/downloader';
import type { CatalogSearchResultDto } from '@music/downloader';
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

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

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
 * The blocks to render, in order. The catalog decides which kind leads — it is the one that read
 * the query — and the rest follow in reading order. A kind that matched nothing is left out
 * entirely rather than heading an empty section.
 */
export function orderedKinds(
  results: CatalogSearchResultDto,
  filter: EntityFilter,
): readonly EntityKind[] {
  const kinds =
    filter === 'all'
      ? [results.leading, ...READING_ORDER.filter((kind) => kind !== results.leading)]
      : [filter];
  return kinds.filter((kind) => countOf(results, kind) > 0);
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

/** Where this application serves a catalog entity's artwork from, at the size being rendered. */
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
 * Every quality floor the request contract accepts, with the words a person chooses it by. Keyed by
 * the wire union, so a new tier is a build error here rather than a tier quietly missing from the
 * form — which is how `LOSSY_LOW` went missing when this page replaced the old one.
 */
export const QUALITY_FLOORS: Record<z.infer<typeof qualityBucketSchema>, string> = {
  LOSSLESS_HIRES: 'Hi-res lossless',
  LOSSLESS: 'Lossless',
  LOSSY_HIGH: 'High quality lossy',
  LOSSY_STANDARD: 'Standard lossy',
  LOSSY_LOW: 'Low quality lossy',
  UNKNOWN: 'Unknown',
};

/** Whether what was typed is a catalog identifier rather than something to search for. */
export function isCatalogId(text: string): boolean {
  return UUID_PATTERN.test(text.trim());
}
