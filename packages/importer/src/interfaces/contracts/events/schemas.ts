import { z } from 'zod';

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
export const releaseVerdictEventSchema = z.object({
  type: z.literal(RELEASE_VERDICT_TYPE),
  timestamp: z.iso.datetime(), // when the verdict was recorded (stable across redeliveries)
  data: releaseVerdictDataSchema,
});

export type ReleaseVerdictData = z.infer<typeof releaseVerdictDataSchema>;
export type ReleaseVerdictEvent = z.infer<typeof releaseVerdictEventSchema>;
