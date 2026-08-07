import { z } from 'zod';

/**
 * The inbound external-verdict contract (change: fulfillment-external-verdict D4): a consumer-
 * defined tolerant reader for verdict webhook deliveries. Only the facts this domain needs are
 * read — the acquisition id, the judged candidate's identity, the verdict, and optional reasons —
 * and every unknown field (the sender's envelope `type`/`timestamp` included) is ignored, so the
 * sender's schema can evolve freely. Unknown *verdict values* are rejected — accepting more
 * verdicts later is an additive relaxation.
 *
 * The candidate reference requires username+path; `sizeBytes` is corroborating detail the sender
 * may omit (the domain's stale-guard then matches on username+path alone).
 */
export const externalVerdictDataSchema = z.object({
  acquisitionId: z.string().min(1),
  candidate: z.object({
    username: z.string(),
    path: z.string(),
    sizeBytes: z.number().optional(),
  }),
  verdict: z.literal('rejected'),
  reasons: z.array(z.string()).optional(),
});

/** The Standard Webhooks-style envelope: everything but `data` is the sender's business. */
export const externalVerdictDeliverySchema = z.object({
  data: externalVerdictDataSchema,
});

export type ExternalVerdictDelivery = z.infer<typeof externalVerdictDeliverySchema>;

/**
 * The producer's operation-correlation envelope, read tolerantly (change: end-to-end-correlation).
 *
 * Consumer-owned, like every other schema here: nothing is imported from the sender. The block is
 * absent for a producer that predates the capability, and a parse failure is treated exactly like
 * absence by the only caller — see `contextForDelivery`. Correlation is diagnostics: it must never
 * be able to fail a delivery.
 *
 * `causation` is the CONSUMED event's coordinates in the PRODUCER's store, which is exactly what
 * this context records as the causal parent of the work the consumption triggers. `context` is
 * read as a free string, not pinned to a literal: it namespaces coordinates that belong to another
 * store, and pinning it here would make this reader break the day a third producer appears.
 */
export const inboundCorrelationSchema = z.object({
  correlationId: z.string().regex(/^[0-9a-f]{32}$/),
  causation: z.object({
    kind: z.literal('event'),
    context: z.string().min(1),
    streamId: z.string().min(1),
    version: z.number().int().nonnegative(),
  }),
});

export type InboundCorrelation = z.infer<typeof inboundCorrelationSchema>;
