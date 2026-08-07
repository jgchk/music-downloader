import {
  adoptStory,
  causedBy,
  newOperation,
  toCorrelationId,
} from '../../../application/correlation/context.js';
import type { CommandContext } from '../../../application/correlation/context.js';
import type { CorrelationSource } from '../../../application/ports/system-ports.js';
import { inboundCorrelationSchema } from './schemas.js';
import type { ExternalValidationFailureInput } from '../../../application/acquisition/use-cases.js';
import type { ExternalVerdictDelivery } from './schemas.js';

/**
 * The anti-corruption translation (fulfillment-external-verdict D4): a tolerantly-parsed verdict
 * delivery becomes the input of the native `RecordExternalValidationFailed` command — the sender's
 * vocabulary stops here.
 */
export function verdictToFailureInput(
  delivery: ExternalVerdictDelivery,
): ExternalValidationFailureInput & { readonly acquisitionId: string } {
  const { acquisitionId, candidate, reasons } = delivery.data;
  return { acquisitionId, candidate, reasons: reasons ?? [] };
}

/**
 * The command context for work triggered by a consumed seam event: the producer's story adopted
 * VERBATIM under a causation reference to the consumed event itself.
 *
 * Adoption, not translation, is the point. The anti-corruption layer translates the producer's
 * MODEL into this context's language; the correlation id is not model — it is an opaque
 * observability identity, and re-minting it here would break the single promise the capability
 * exists to keep: one id follows one operation through the whole system.
 *
 * An absent or unusable envelope yields a freshly minted story, so consumption is unaffected.
 */
export function contextForDelivery(metadata: unknown, source: CorrelationSource): CommandContext {
  const carried = inboundCorrelationSchema.safeParse(metadata);
  // Absent, or present but unusable — the same answer either way: start our own story and get on
  // with the delivery. A trace we cannot join is worth strictly less than the work.
  if (!carried.success) return newOperation(source);
  const { correlationId, causation } = carried.data;
  return adoptStory(
    toCorrelationId(correlationId),
    causedBy(causation.context, causation.streamId, causation.version),
  );
}
