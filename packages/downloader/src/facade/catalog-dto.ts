import { z } from 'zod';
import type {
  CatalogArtist,
  CatalogEdition,
  CatalogEditionListing,
  CatalogLookup,
  CatalogRecording,
  CatalogReleaseGroup,
  CatalogSearchResults,
  CatalogTrack,
} from '../application/ports/catalog-search-port.js';

/**
 * The wire shapes of the catalog-search reads, plus the identifier rule a caller needs to tell a
 * search from a lookup. Reachable on its own subpath (`@music/downloader/catalog-dto`) because a
 * browser bundle imports these schemas as VALUES: through the main barrel that would pull the
 * facade — and the application layer behind it — into the page.
 *
 * These are DTOs, not domain types, so they follow the wire's rules rather than the domain's: a
 * discriminating tag beside optional fields (never a union a serializer would flatten), identifiers
 * as plain strings, and every field a caller does not need omitted. What the catalog does not know
 * — a year, a type, a duration, a track count — is an absent field, never a sentinel. One
 * exception is deliberate: a name the catalog does not state (an edition's, a track's, an artist
 * credit) carries `''`, because a reader renders those unconditionally as positional context and
 * an absent name would leave a hole where a row's shape should be.
 */

export const catalogReleaseGroupDtoSchema = z.object({
  mbid: z.string(),
  title: z.string(),
  artistCredit: z.string(),
  year: z.number().optional(),
  primaryType: z.string().optional(),
  secondaryTypes: z.array(z.string()),
});

export const catalogArtistDtoSchema = z.object({
  mbid: z.string(),
  name: z.string(),
  disambiguation: z.string().optional(),
});

export const catalogRecordingDtoSchema = z.object({
  mbid: z.string(),
  title: z.string(),
  artistCredit: z.string(),
  release: z.object({ mbid: z.string(), title: z.string() }).optional(),
});

export const catalogSearchResultSchema = z.object({
  /** Which block answers the query best, so a presenter can lead with it. */
  leading: z.enum(['release-group', 'artist', 'recording']),
  releaseGroups: z.array(catalogReleaseGroupDtoSchema),
  artists: z.array(catalogArtistDtoSchema),
  recordings: z.array(catalogRecordingDtoSchema),
});

/**
 * Tag plus optional fields: one shape a caller can narrow on, including the "nothing" answer. The
 * refinement is what keeps that shape honest — a tag whose payload is absent would otherwise reach
 * a reader as a found entity carrying nothing, and render as "nothing matched" for something the
 * server said it found.
 */
export const catalogLookupResultSchema = z
  .object({
    kind: z.enum(['release-group', 'artist', 'recording', 'not-found']),
    /** Present exactly when `kind` is `release-group`. */
    releaseGroup: catalogReleaseGroupDtoSchema.optional(),
    /** Present exactly when `kind` is `artist`. */
    artist: catalogArtistDtoSchema.optional(),
    /** Present exactly when `kind` is `recording`. */
    recording: catalogRecordingDtoSchema.optional(),
  })
  .refine((result) => {
    // Both directions: the tagged payload present, and no OTHER payload alongside it. A reader
    // that narrows on the tag would ignore a stray payload; one that reads by field presence —
    // and the page's lookup does — would render it as a second block of results under the wrong
    // heading. Only the tag decides what a lookup found.
    const carried = (['releaseGroup', 'artist', 'recording'] as const).filter(
      (payload) => result[payload] !== undefined,
    );
    if (result.kind === 'not-found') return carried.length === 0;
    const expected = { 'release-group': 'releaseGroup', artist: 'artist', recording: 'recording' }[
      result.kind
    ];
    return carried.length === 1 && carried[0] === expected;
  }, 'exactly the payload named by the tag must be present');

export const catalogDiscographyResultSchema = z.object({
  releaseGroups: z.array(catalogReleaseGroupDtoSchema),
});

export const catalogEditionDtoSchema = z.object({
  mbid: z.string(),
  title: z.string(),
  disambiguation: z.string().optional(),
  date: z.string().optional(),
  country: z.string().optional(),
  formats: z.array(z.string()),
  status: z.string().optional(),
  /** Absent when the catalog states no count — which is not the same fact as a count of zero. */
  trackCount: z.number().optional(),
});

export const catalogEditionsResultSchema = z
  .object({
    /**
     * Ordered most-editions-first, so the most-published tracklist leads. The order is part of
     * this contract, not an accident of iteration: a reader labels the first group as the common
     * one, and would relabel the wrong tracklist if a producer re-sorted without saying so.
     */
    groups: z.array(
      z.object({
        /**
         * The edition the group's tracklist is read from — always present, never inferred. Its
         * `trackCount` IS the group's; carried once so the two can never disagree.
         */
        representative: catalogEditionDtoSchema,
        editions: z.array(catalogEditionDtoSchema),
      }),
    ),
    /**
     * `pick` carries the FIRST edition the pipeline would try (it walks its picker's ordered ids
     * and takes the first that yields a usable target, so it may skip past this one);
     * `selection-required` carries none.
     */
    bestMatch: z
      .object({
        kind: z.enum(['pick', 'selection-required']),
        /** Present exactly when `kind` is `pick`. */
        mbid: z.string().optional(),
      })
      // A `pick` with no edition would be read as "selection required" and tell the person the
      // opposite of what the pipeline would do.
      .refine(
        (best) => best.kind === 'selection-required' || best.mbid !== undefined,
        'a pick must name the edition it picked',
      ),
  })
  // A pick naming an edition that is not in the listing renders as NEITHER a badge nor the
  // "no default" notice — the surface would say nothing at all about what the pipeline would do,
  // which is the one thing it exists to preview.
  .refine(
    (result) =>
      result.bestMatch.kind !== 'pick' ||
      result.groups.some((group) =>
        group.editions.some((edition) => edition.mbid === result.bestMatch.mbid),
      ),
    'a pick must name one of the editions listed',
  );

export const catalogTracklistResultSchema = z.object({
  tracks: z.array(
    z.object({ position: z.number(), title: z.string(), durationMs: z.number().optional() }),
  ),
});

export type CatalogSearchResultDto = z.infer<typeof catalogSearchResultSchema>;
export type CatalogLookupResultDto = z.infer<typeof catalogLookupResultSchema>;
export type CatalogDiscographyResultDto = z.infer<typeof catalogDiscographyResultSchema>;
export type CatalogEditionsResultDto = z.infer<typeof catalogEditionsResultSchema>;
export type CatalogTracklistResultDto = z.infer<typeof catalogTracklistResultSchema>;

function releaseGroupToDto(
  group: CatalogReleaseGroup,
): z.infer<typeof catalogReleaseGroupDtoSchema> {
  return {
    mbid: group.mbid,
    title: group.title,
    artistCredit: group.artistCredit,
    year: group.year,
    primaryType: group.primaryType,
    secondaryTypes: [...group.secondaryTypes],
  };
}

function artistToDto(artist: CatalogArtist): z.infer<typeof catalogArtistDtoSchema> {
  return { mbid: artist.mbid, name: artist.name, disambiguation: artist.disambiguation };
}

function recordingToDto(recording: CatalogRecording): z.infer<typeof catalogRecordingDtoSchema> {
  return {
    mbid: recording.mbid,
    title: recording.title,
    artistCredit: recording.artistCredit,
    release:
      recording.release === undefined
        ? undefined
        : { mbid: recording.release.mbid, title: recording.release.title },
  };
}

export function searchResultsToDto(results: CatalogSearchResults): CatalogSearchResultDto {
  return {
    leading: results.leading,
    releaseGroups: results.releaseGroups.map((group) => releaseGroupToDto(group)),
    artists: results.artists.map((artist) => artistToDto(artist)),
    recordings: results.recordings.map((recording) => recordingToDto(recording)),
  };
}

export function lookupToDto(lookup: CatalogLookup): CatalogLookupResultDto {
  if (lookup.kind === 'notFound') return { kind: 'not-found' };
  const { entity } = lookup;
  switch (entity.kind) {
    case 'release-group': {
      return { kind: 'release-group', releaseGroup: releaseGroupToDto(entity.releaseGroup) };
    }
    case 'artist': {
      return { kind: 'artist', artist: artistToDto(entity.artist) };
    }
    // Named rather than defaulted, so a fourth catalog entity kind is a compile error here rather
    // than a DTO that claims to be a recording and carries none.
    case 'recording': {
      return { kind: 'recording', recording: recordingToDto(entity.recording) };
    }
  }
}

export function discographyToDto(
  groups: readonly CatalogReleaseGroup[],
): CatalogDiscographyResultDto {
  return { releaseGroups: groups.map((group) => releaseGroupToDto(group)) };
}

function editionToDto(edition: CatalogEdition): z.infer<typeof catalogEditionDtoSchema> {
  return {
    mbid: edition.mbid,
    title: edition.title,
    disambiguation: edition.disambiguation,
    date: edition.date,
    country: edition.country,
    formats: [...edition.formats],
    status: edition.status,
    trackCount: edition.trackCount,
  };
}

export function editionsToDto(listing: CatalogEditionListing): CatalogEditionsResultDto {
  return {
    groups: listing.groups.map((group) => ({
      representative: editionToDto(group.representative),
      editions: group.editions.map((edition) => editionToDto(edition)),
    })),
    bestMatch:
      listing.bestMatch.kind === 'pick'
        ? { kind: 'pick', mbid: listing.bestMatch.mbid }
        : { kind: 'selection-required' },
  };
}

export function tracklistToDto(tracks: readonly CatalogTrack[]): CatalogTracklistResultDto {
  return {
    tracks: tracks.map((track) => ({
      position: track.position,
      title: track.title,
      durationMs: track.durationMs,
    })),
  };
}

/**
 * Whether text names a catalog entity rather than describing one. Re-exported from the domain that
 * owns the format, so a page deciding "search" from "look up" does not carry its own copy of the
 * rule — three spellings of one regex is three chances to disagree.
 */
export { isMbidShaped } from '../domain/shared/mbid.js';
