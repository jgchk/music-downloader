import { z } from 'zod';

/**
 * The outbound published-event contracts (change: acquisition-outbound-events): the single,
 * producer-owned source of truth for what this tool announces to the world. Every outgoing payload
 * is validated against these schemas before delivery; `scripts/contracts/` generates the committed
 * JSON Schema artifacts from them, and the contract-test tier enforces the evolution rule —
 * **additive-only within an event type; a breaking change is a new `type`**. Optional facts carry
 * explicit `null` defaults so absent-field behavior lives in the contract, not in receiver code.
 *
 * The vocabulary is deliberately this tool's own ubiquitous language (acquisition, target,
 * candidate, fulfilled); consumers translate at their anti-corruption layers.
 */

export const ACQUISITION_FULFILLED_TYPE = 'acquisition.fulfilled';

/** One file deposited at the library location. */
export const publishedFileSchema = z.object({
  name: z.string().min(1),
  path: z.string().min(1), // absolute path of the deposited file
});

export const acquisitionFulfilledDataSchema = z.object({
  /** The acquisition's id — with the delivery's `webhook-id`, a consumer's dedup key. */
  acquisitionId: z.string().min(1),
  /** The resolved target the deposit satisfies, in MusicBrainz terms. */
  target: z.object({
    type: z.enum(['album', 'track']),
    artist: z.string().min(1),
    title: z.string().min(1),
    musicbrainzReleaseId: z.string().min(1).nullable().default(null),
    year: z.number().int().nullable().default(null),
    trackCount: z.number().int().nonnegative(),
  }),
  /** The fulfilled candidate's source identity (which peer's copy won). */
  candidate: z.object({
    username: z.string(),
    path: z.string(),
    sizeBytes: z.number(),
  }),
  /** The deposited library location (absolute directory) and its files. */
  location: z.string().min(1),
  files: z.array(publishedFileSchema),
});

/** The Standard Webhooks body: `{type, timestamp, data}`. */
export const acquisitionFulfilledEventSchema = z.object({
  type: z.literal(ACQUISITION_FULFILLED_TYPE),
  timestamp: z.iso.datetime(), // when the acquisition was fulfilled (stable across redeliveries)
  data: acquisitionFulfilledDataSchema,
});

export type AcquisitionFulfilledData = z.infer<typeof acquisitionFulfilledDataSchema>;
export type AcquisitionFulfilledEvent = z.infer<typeof acquisitionFulfilledEventSchema>;
