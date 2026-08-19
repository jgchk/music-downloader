import { z } from 'zod';

/**
 * The codified consumer contract for the MusicBrainz JSON web service (`fmt=json`). These schemas
 * model only the fields the adapter actually reads (D1) and deliberately tolerate unknown fields —
 * MusicBrainz adding data is not drift, so `z.object` strips extras rather than rejecting. A
 * *consumed* field going missing or changing type does fail validation, turning provider drift into
 * a modeled boundary failure at parse time (D2). The inferred types are the adapter's only view of
 * the payloads; the hand-written interfaces they replace are gone so the two cannot diverge.
 */

// Every optional metadata string below is also nullable: MusicBrainz reports "unknown" as null
// (status, dates, titles, credits alike), and null is a value, not drift — a strict field here
// turns one sparse release into a permanently-retried resolution fault (the Red Headed Stranger
// wedge, prod 2026-07-22). Only entity ids stay non-nullable; a null id would be genuine drift.
const artistCreditSchema = z.object({
  name: z.string().nullable().optional(),
  joinphrase: z.string().nullable().optional(),
});

// MusicBrainz returns `length: null` for a track/recording whose duration it does not know — a
// legitimate value, not drift — so lengths are nullable; the mapping treats null as no usable
// duration (the release then yields no valid target and the caller falls through to the next).
const trackSchema = z.object({
  position: z.number().optional(),
  title: z.string().nullable().optional(),
  length: z.number().nullable().optional(),
  recording: z
    .object({ title: z.string().nullable().optional(), length: z.number().nullable().optional() })
    .optional(),
});

/** `GET /release/{mbid}?inc=recordings+artist-credits&fmt=json`. */
export const mbReleaseSchema = z.object({
  id: z.string().optional(),
  title: z.string().nullable().optional(),
  date: z.string().nullable().optional(),
  'artist-credit': z.array(artistCreditSchema).optional(),
  media: z.array(z.object({ tracks: z.array(trackSchema).optional() })).optional(),
});

/** `GET /recording/{mbid}?inc=artist-credits&fmt=json`. */
export const mbRecordingSchema = z.object({
  id: z.string().optional(),
  title: z.string().nullable().optional(),
  length: z.number().nullable().optional(),
  'artist-credit': z.array(artistCreditSchema).optional(),
});

const scoredEntrySchema = z.object({ id: z.string().optional(), score: z.number().optional() });

/**
 * A scored release-search hit. Beyond the scored id, the release entity carries the fields that let
 * the adapter resolve an album's *identity* (its release group) apart from its *editions*: the
 * `release-group` id groups editions of one album and its `title` names that identity (the
 * exact-title preference compares it against the request), while `title`, `status`, and `date`
 * drive edition selection within the resolved group. All are optional — a missing field degrades
 * selection, never the scored-id contract the recording path also relies on.
 */
const scoredReleaseSchema = z.object({
  id: z.string().optional(),
  score: z.number().optional(),
  title: z.string().nullable().optional(),
  status: z.string().nullable().optional(),
  date: z.string().nullable().optional(),
  'release-group': z
    .object({ id: z.string().optional(), title: z.string().nullable().optional() })
    .optional(),
});

/** `GET /release?query=…&fmt=json` — the scored hit list with each hit's identity/edition fields. */
export const mbReleaseSearchSchema = z.object({
  releases: z.array(scoredReleaseSchema).optional(),
});

/**
 * One edition of a known release group, as returned by the browse `GET /release?release-group={mbid}
 * &inc=media&fmt=json`. A browse carries no relevance `score` (identity is given); the picker reads
 * only `status` and `date` (edition selection) and the per-medium `track-count`s, whose sum is the
 * edition's total track count. `title`, `country`, and the per-medium `format` are consumed to
 * present candidate editions for manual selection (`date` and the track count do double duty
 * there). All fields are optional — a
 * sparse edition degrades selection or presentation (e.g. an unknown track count of 0 simply won't
 * be modal), never the resolution as a whole.
 */
const browseReleaseSchema = z.object({
  id: z.string().optional(),
  title: z.string().nullable().optional(),
  // What makes this pressing different from its siblings ("UK limited edition gatefold"). Editions
  // of one group share a title, so this is often the only thing telling two rows apart on screen.
  disambiguation: z.string().nullable().optional(),
  status: z.string().nullable().optional(),
  date: z.string().nullable().optional(),
  country: z.string().nullable().optional(), // null = MusicBrainz doesn't know — a value, not drift
  media: z
    .array(
      z.object({
        'track-count': z.number().optional(),
        format: z.string().nullable().optional(), // null = unknown medium format, likewise
      }),
    )
    .optional(),
});

/** `GET /release?release-group={mbid}&inc=media&fmt=json` — the editions of one release group. */
export const mbReleaseGroupBrowseSchema = z.object({
  releases: z.array(browseReleaseSchema).optional(),
});

/** `GET /recording?query=…&fmt=json`. */
export const mbRecordingSearchSchema = z.object({
  recordings: z.array(scoredEntrySchema).optional(),
});

/**
 * The catalog-search half of the contract. Search-to-FORMULATE-a-request reads different fields
 * than resolve-a-request does: it needs what a person recognizes on screen (titles, credits, years,
 * types, the release a recording sits on) where resolution needs only scored ids. Modeling that as
 * its own set of schemas keeps the resolution path's tolerances untouched — a presentation field
 * going missing must never turn into a resolution fault.
 *
 * `id` is the one REQUIRED field in all three. Everything else is presentation and may go missing
 * without the answer becoming unreadable, but a hit with no identifier cannot be shown, requested,
 * or told apart from its neighbours — the mapper drops it either way. Requiring it here is what
 * turns a rename of `id` into the permanent drift fault this adapter reports, instead of a
 * perfectly-parsing answer whose every hit is silently discarded.
 */
const releaseGroupEntitySchema = z.object({
  id: z.string(),
  score: z.number().optional(), // absent on a browse, present on a search
  title: z.string().nullable().optional(),
  'first-release-date': z.string().nullable().optional(),
  'primary-type': z.string().nullable().optional(),
  'secondary-types': z.array(z.string()).nullable().optional(), // Live/Remix/Compilation/…
  'artist-credit': z.array(artistCreditSchema).optional(),
});

const artistEntitySchema = z.object({
  id: z.string(),
  score: z.number().optional(),
  name: z.string().nullable().optional(),
  disambiguation: z.string().nullable().optional(),
  type: z.string().nullable().optional(), // Person/Group/… — shown when there is no disambiguation
});

const catalogRecordingSchema = z.object({
  id: z.string(),
  score: z.number().optional(),
  title: z.string().nullable().optional(),
  'artist-credit': z.array(artistCreditSchema).optional(),
  // Only the first ADDRESSABLE release is read, for artwork and context: the mapper walks past a
  // release whose id it cannot parse, and the rest of the list is ignored.
  releases: z
    .array(z.object({ id: z.string().optional(), title: z.string().nullable().optional() }))
    .optional(),
});

/** `GET /release-group/{mbid}?inc=artist-credits&fmt=json` — one album identity by id. */
export const mbReleaseGroupEntitySchema = releaseGroupEntitySchema;
/** `GET /artist/{mbid}?fmt=json` — one artist by id. */
export const mbArtistEntitySchema = artistEntitySchema;
/** `GET /recording/{mbid}?inc=artist-credits+releases&fmt=json` — one recording by id. */
export const mbCatalogRecordingEntitySchema = catalogRecordingSchema;

/** `GET /release-group?query=…&fmt=json` (and `GET /release-group?artist=…`, the same shape). */
export const mbReleaseGroupSearchSchema = z.object({
  'release-groups': z.array(releaseGroupEntitySchema).optional(),
});

/** `GET /artist?query=…&fmt=json`. */
export const mbArtistSearchSchema = z.object({
  artists: z.array(artistEntitySchema).optional(),
});

/** `GET /recording?query=…&inc=releases&fmt=json` — the presentation-shaped recording search. */
export const mbCatalogRecordingSearchSchema = z.object({
  recordings: z.array(catalogRecordingSchema).optional(),
});

export type MbRelease = z.infer<typeof mbReleaseSchema>;
export type MbRecording = z.infer<typeof mbRecordingSchema>;
export type MbScoredEntry = z.infer<typeof scoredEntrySchema>;
export type MbScoredRelease = z.infer<typeof scoredReleaseSchema>;
export type MbReleaseSearch = z.infer<typeof mbReleaseSearchSchema>;
export type MbRecordingSearch = z.infer<typeof mbRecordingSearchSchema>;
export type MbReleaseGroupBrowse = z.infer<typeof mbReleaseGroupBrowseSchema>;
export type MbBrowseRelease = z.infer<typeof browseReleaseSchema>;
export type MbReleaseGroupEntity = z.infer<typeof releaseGroupEntitySchema>;
export type MbArtistEntity = z.infer<typeof artistEntitySchema>;
export type MbCatalogRecording = z.infer<typeof catalogRecordingSchema>;
export type MbReleaseGroupSearch = z.infer<typeof mbReleaseGroupSearchSchema>;
export type MbArtistSearch = z.infer<typeof mbArtistSearchSchema>;
export type MbCatalogRecordingSearch = z.infer<typeof mbCatalogRecordingSearchSchema>;
