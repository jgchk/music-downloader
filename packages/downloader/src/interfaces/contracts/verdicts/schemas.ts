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
