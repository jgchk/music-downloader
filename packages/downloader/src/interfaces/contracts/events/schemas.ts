import { z } from 'zod';
import { CONTEXT_NAME } from '../../../application/correlation/context.js';
import { CORRELATION_ID_PATTERN } from '../../../application/correlation/correlation-id.js';

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

/**
 * The operation-correlation envelope (change: end-to-end-correlation) — OPTIONAL, additive, and
 * deliberately NOT part of `data`.
 *
 * `correlationId` is the STORY: the id this operation has carried since its outermost trigger. A
 * consumer adopts it verbatim as the story of whatever work the consumption triggers, so one id
 * follows one operation across both stores. It is an opaque observability identity, not producer
 * vocabulary — the anti-corruption layer translates the MODEL (`data`), never this envelope.
 *
 * `causation` is THIS event's own coordinates in the producer's store, namespaced by context: the
 * reference a consumer should record as the causal parent of the work it does on receipt. The
 * producer's own internal causation chain is deliberately NOT published — it is provenance the
 * consumer has no use for, and shipping it would leak the producer's stream graph across the seam.
 *
 * The whole block is absent for events stored before this capability existed. That absence is
 * permanent and normal: nothing is backfilled and no upcaster fabricates a story, so a consumer
 * must treat it as optional forever and mint fresh when it is missing.
 */
export const publishedCorrelationSchema = z.object({
  correlationId: z.string().regex(CORRELATION_ID_PATTERN),
  causation: z.object({
    kind: z.literal('event'),
    context: z.literal(CONTEXT_NAME),
    streamId: z.string().min(1),
    version: z.number().int().nonnegative(),
  }),
});

export type PublishedCorrelation = z.infer<typeof publishedCorrelationSchema>;

/** The Standard Webhooks body: `{type, timestamp, data}`, plus the optional correlation block. */
export const acquisitionFulfilledEventSchema = z.object({
  type: z.literal(ACQUISITION_FULFILLED_TYPE),
  timestamp: z.iso.datetime(), // when the acquisition was fulfilled (stable across redeliveries)
  data: acquisitionFulfilledDataSchema,
  metadata: publishedCorrelationSchema.optional(),
});

export type AcquisitionFulfilledData = z.infer<typeof acquisitionFulfilledDataSchema>;
export type AcquisitionFulfilledEvent = z.infer<typeof acquisitionFulfilledEventSchema>;
