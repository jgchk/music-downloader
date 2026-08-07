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
 * The two failure cases are NOT the same and must not be reported as one:
 *  - **no block at all** — a producer that predates the capability. Permanent, expected, silent.
 *  - **a block this reader cannot parse** — a LIVE producer whose envelope has drifted from this
 *    reader. Every cross-context trace is broken until someone fixes it, and the symptom
 *    (traces that stop joining at the seam) is otherwise indistinguishable from the first case.
 *    That one is announced.
 *
 * Either way the delivery proceeds on a fresh story: correlation may degrade the trace, never the
 * work.
 */
export function contextForDelivery(
  metadata: unknown,
  source: CorrelationSource,
  onUnreadable: (detail: string) => void,
): CommandContext {
  if (metadata === undefined || metadata === null) return newOperation(source);
  const carried = inboundCorrelationSchema.safeParse(metadata);
  if (!carried.success) {
    onUnreadable(carried.error.message);
    return newOperation(source);
  }
  const { correlationId, causation } = carried.data;
  return adoptStory(
    toCorrelationId(correlationId),
    causedBy(causation.context, causation.streamId, causation.version),
  );
}
