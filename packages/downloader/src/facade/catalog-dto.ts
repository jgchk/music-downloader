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
 * The wire shapes of the catalog-search reads.
 *
 * These are DTOs, not domain types, so they follow the wire's rules rather than the domain's: a
 * discriminating tag beside optional fields (never a union a serializer would flatten), identifiers
 * as plain strings, and every field a caller does not need omitted. What the catalog does not know
 * — a year, a type, a duration — is an absent field, never a sentinel. Two exceptions are
 * deliberate: an unnamed edition or track carries `''` and an uncounted edition carries `0`,
 * because a detail surface renders them unconditionally as positional context.
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
  .refine(
    (result) =>
      (result.kind === 'release-group' && result.releaseGroup !== undefined) ||
      (result.kind === 'artist' && result.artist !== undefined) ||
      (result.kind === 'recording' && result.recording !== undefined) ||
      result.kind === 'not-found',
    'the payload named by the tag must be present',
  );

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
  trackCount: z.number(),
});

export const catalogEditionsResultSchema = z.object({
  groups: z.array(
    z.object({
      trackCount: z.number(),
      /** The edition the group's tracklist is read from — always present, never inferred. */
      representative: catalogEditionDtoSchema,
      editions: z.array(catalogEditionDtoSchema),
    }),
  ),
  /** `pick` carries the edition the pipeline would choose; `selection-required` carries none. */
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
});

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
      trackCount: group.trackCount,
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
