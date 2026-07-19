import type { FastifyInstance } from 'fastify';
import { recordExternalValidationFailure } from '../../application/acquisition/use-cases.js';
import type { UseCaseDeps } from '../../application/acquisition/use-cases.js';
import { verdictToFailureInput } from '../contracts/verdicts/mapping.js';
import { externalVerdictDeliverySchema } from '../contracts/verdicts/schemas.js';
import { statusForCommandError } from './app.js';
import { signingKeyOf, verifyWebhookDelivery } from './webhook-verification.js';

/**
 * The inbound verdict webhook receiver (fulfillment-external-verdict D4): a Standard Webhooks-
 * style edge that verifies the shared-secret signature and timestamp over the *raw* body before
 * any parsing, dedupes by `webhook-id`, tolerantly reads only the fields this domain needs, and
 * translates through the ACL into the native `RecordExternalValidationFailed` command via the one
 * command handler — where `decide`'s guards make redelivery and staleness converge to no-ops.
 * Config-dormant: the composition root registers this route only when a receiver secret is
 * configured; without one the endpoint does not exist.
 */

export const VERDICT_WEBHOOK_PATH = '/api/v1/webhooks/verdicts';

export interface VerdictWebhookConfig {
  readonly secret: string; // `whsec_<base64>`, shared with the sender
}

/**
 * A bounded first-seen set of delivery ids (defense-in-depth: `decide` already converges on
 * redelivery). Insertion-ordered eviction keeps memory constant across a long-lived process.
 */
export class DeliveryDedupe {
  private readonly seen = new Set<string>();

  constructor(private readonly capacity = 4096) {}

  has(id: string): boolean {
    return this.seen.has(id);
  }

  add(id: string): void {
    if (this.seen.size >= this.capacity) {
      const oldest = this.seen.values().next().value;
      if (oldest !== undefined) this.seen.delete(oldest);
    }
    this.seen.add(id);
  }
}

function headerOf(value: string | readonly string[] | undefined): string | undefined {
  return typeof value === 'string' ? value : undefined;
}

export async function registerVerdictWebhook(
  app: FastifyInstance,
  deps: UseCaseDeps,
  config: VerdictWebhookConfig,
): Promise<void> {
  const key = signingKeyOf(config.secret);
  const seen = new DeliveryDedupe();

  await app.register((scope, _opts, done) => {
    // The signature covers the exact request bytes, so this scope keeps the body a raw string —
    // verification strictly precedes parsing (encapsulated: other routes parse JSON as usual).
    scope.addContentTypeParser<string>(
      'application/json',
      { parseAs: 'string' },
      (_request, body, done) => {
        done(null, body);
      },
    );

    scope.post<{ Body: string }>(VERDICT_WEBHOOK_PATH, async (request, reply) => {
      const body = request.body;
      const verified = verifyWebhookDelivery({
        key,
        headers: {
          id: headerOf(request.headers['webhook-id']),
          timestamp: headerOf(request.headers['webhook-timestamp']),
          signature: headerOf(request.headers['webhook-signature']),
        },
        body,
        now: deps.clock.now(),
      });
      if (verified.isErr()) {
        return reply.code(401).send({ error: verified.error });
      }
      const { deliveryId } = verified.value;
      if (seen.has(deliveryId)) {
        return reply.code(204).send();
      }

      let payload: unknown;
      try {
        payload = JSON.parse(body);
      } catch {
        return reply.code(400).send({ error: 'InvalidPayload' });
      }
      const parsed = externalVerdictDeliverySchema.safeParse(payload);
      if (!parsed.success) {
        return reply.code(400).send({ error: 'InvalidPayload' });
      }

      const { acquisitionId, candidate, reasons } = verdictToFailureInput(parsed.data);
      const result = await recordExternalValidationFailure(deps, acquisitionId, {
        candidate,
        reasons,
      });
      return result.match(
        () => {
          // Consumed only on success: a failed append leaves the id fresh for the sender's retry.
          seen.add(deliveryId);
          request.log.info({ acquisitionId, deliveryId }, 'external verdict recorded');
          return reply.code(204).send();
        },
        (error) => reply.code(statusForCommandError(error)).send({ error: error.kind }),
      );
    });

    done();
  });
}
