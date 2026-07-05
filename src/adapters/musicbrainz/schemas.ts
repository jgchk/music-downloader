import { z } from 'zod';

/**
 * The codified consumer contract for the MusicBrainz JSON web service (`fmt=json`). These schemas
 * model only the fields the adapter actually reads (D1) and deliberately tolerate unknown fields —
 * MusicBrainz adding data is not drift, so `z.object` strips extras rather than rejecting. A
 * *consumed* field going missing or changing type does fail validation, turning provider drift into
 * a modeled boundary failure at parse time (D2). The inferred types are the adapter's only view of
 * the payloads; the hand-written interfaces they replace are gone so the two cannot diverge.
 */

const artistCreditSchema = z.object({
  name: z.string().optional(),
  joinphrase: z.string().optional(),
});

// MusicBrainz returns `length: null` for a track/recording whose duration it does not know — a
// legitimate value, not drift — so lengths are nullable; the mapping treats null as no usable
// duration (the release then yields no valid target and the caller falls through to the next).
const trackSchema = z.object({
  position: z.number().optional(),
  title: z.string().optional(),
  length: z.number().nullable().optional(),
  recording: z
    .object({ title: z.string().optional(), length: z.number().nullable().optional() })
    .optional(),
});

/** `GET /release/{mbid}?inc=recordings+artist-credits&fmt=json`. */
export const mbReleaseSchema = z.object({
  id: z.string().optional(),
  title: z.string().optional(),
  date: z.string().optional(),
  'artist-credit': z.array(artistCreditSchema).optional(),
  media: z.array(z.object({ tracks: z.array(trackSchema).optional() })).optional(),
});

/** `GET /recording/{mbid}?inc=artist-credits&fmt=json`. */
export const mbRecordingSchema = z.object({
  id: z.string().optional(),
  title: z.string().optional(),
  length: z.number().nullable().optional(),
  'artist-credit': z.array(artistCreditSchema).optional(),
});

const scoredEntrySchema = z.object({ id: z.string().optional(), score: z.number().optional() });

/**
 * A scored release-search hit. Beyond the scored id, the release entity carries the fields that let
 * the adapter resolve an album's *identity* (its release group) apart from its *editions*: the
 * `release-group` id groups editions of one album, while `title`, `status`, and `date` drive
 * edition selection within the resolved group. All are optional — a missing field degrades
 * selection, never the scored-id contract the recording path also relies on.
 */
const scoredReleaseSchema = z.object({
  id: z.string().optional(),
  score: z.number().optional(),
  title: z.string().optional(),
  status: z.string().optional(),
  date: z.string().optional(),
  'release-group': z.object({ id: z.string().optional() }).optional(),
});

/** `GET /release?query=…&fmt=json` — the scored hit list with each hit's identity/edition fields. */
export const mbReleaseSearchSchema = z.object({
  releases: z.array(scoredReleaseSchema).optional(),
});

/** `GET /recording?query=…&fmt=json`. */
export const mbRecordingSearchSchema = z.object({
  recordings: z.array(scoredEntrySchema).optional(),
});

export type MbRelease = z.infer<typeof mbReleaseSchema>;
export type MbRecording = z.infer<typeof mbRecordingSchema>;
export type MbScoredEntry = z.infer<typeof scoredEntrySchema>;
export type MbScoredRelease = z.infer<typeof scoredReleaseSchema>;
export type MbReleaseSearch = z.infer<typeof mbReleaseSearchSchema>;
export type MbRecordingSearch = z.infer<typeof mbRecordingSearchSchema>;
