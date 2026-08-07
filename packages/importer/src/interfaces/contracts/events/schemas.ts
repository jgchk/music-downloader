import { z } from 'zod';
import { CONTEXT_NAME } from '../../../application/correlation/context.js';
import { CORRELATION_ID_PATTERN } from '../../../application/correlation/correlation-id.js';

/**
 * The outbound published-event contracts (change: outbound-release-verdicts): the single,
 * producer-owned source of truth for what this tool announces to the world. Every outgoing payload
 * is validated against these schemas before delivery; `scripts/contracts/` generates the committed
 * JSON Schema artifacts from them, and the contract-test tier enforces the evolution rule —
 * **additive-only within an event type; a breaking change is a new `type`**.
 *
 * The payload is this tool's own self-contained "release rejected" notification: the originating
 * acquisition id, the delivered candidate's identity `{username, path, sizeBytes?}`, the verdict
 * (`rejected`), and the reviewer's reasons — everything the fact carries, in our vocabulary, with no
 * shared kernel. Our serialization convention keeps every field either present-and-typed or absent:
 * an unknown `sizeBytes` is OMITTED entirely (never null). Consumers translate at their own
 * anti-corruption layers; we do not model how they parse it.
 */

export const RELEASE_VERDICT_TYPE = 'release.verdict';

export const releaseVerdictDataSchema = z.object({
  /** The originating acquisition this verdict is about. */
  acquisitionId: z.string().min(1),
  /** The delivered candidate's identity, as we recorded it on the acquisition's import. */
  candidate: z.object({
    username: z.string(),
    path: z.string(),
    // Our convention omits an unknown size entirely rather than emitting null.
    sizeBytes: z.number().optional(),
  }),
  /** The adjudication. Only `rejected` exists today; new verdicts are additive later. */
  verdict: z.literal('rejected'),
  /** The reviewer's reasons (possibly empty). */
  reasons: z.array(z.string()),
});

/** The Standard Webhooks body: `{type, timestamp, data}`. */

/**
 * The operation-correlation envelope (change: end-to-end-correlation) — OPTIONAL, additive, and
 * deliberately NOT part of `data`.
 *
 * `correlationId` is the STORY: the id this operation has carried since its outermost trigger —
 * which, for a verdict on a downloader-delivered import, is the id that ALREADY crossed the seam
 * inbound, so the full downloader → importer → verdict → downloader round trip shares one id. It
 * is an opaque observability identity, not producer vocabulary — the anti-corruption layer
 * translates the MODEL (`data`), never this envelope.
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

export const releaseVerdictEventSchema = z.object({
  type: z.literal(RELEASE_VERDICT_TYPE),
  timestamp: z.iso.datetime(), // when the verdict was recorded (stable across redeliveries)
  data: releaseVerdictDataSchema,
  metadata: publishedCorrelationSchema.optional(),
});

export type ReleaseVerdictData = z.infer<typeof releaseVerdictDataSchema>;
export type ReleaseVerdictEvent = z.infer<typeof releaseVerdictEventSchema>;
