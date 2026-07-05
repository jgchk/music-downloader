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

const trackSchema = z.object({
  position: z.number().optional(),
  title: z.string().optional(),
  length: z.number().optional(),
  recording: z.object({ title: z.string().optional(), length: z.number().optional() }).optional(),
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
  length: z.number().optional(),
  'artist-credit': z.array(artistCreditSchema).optional(),
});

const scoredEntrySchema = z.object({ id: z.string().optional(), score: z.number().optional() });

/** `GET /release?query=…&fmt=json` — only the scored hit list is consumed. */
export const mbReleaseSearchSchema = z.object({ releases: z.array(scoredEntrySchema).optional() });

/** `GET /recording?query=…&fmt=json`. */
export const mbRecordingSearchSchema = z.object({
  recordings: z.array(scoredEntrySchema).optional(),
});

export type MbRelease = z.infer<typeof mbReleaseSchema>;
export type MbRecording = z.infer<typeof mbRecordingSchema>;
export type MbScoredEntry = z.infer<typeof scoredEntrySchema>;
export type MbReleaseSearch = z.infer<typeof mbReleaseSearchSchema>;
export type MbRecordingSearch = z.infer<typeof mbRecordingSearchSchema>;
