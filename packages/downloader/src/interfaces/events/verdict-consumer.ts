import { err, ok } from 'neverthrow';
import type { UseCaseDependencies } from '../../application/acquisition/use-cases.js';
import { recordExternalValidationFailure } from '../../application/acquisition/use-cases.js';
import type { ConsumeHandler, SeamEvent } from '../../application/events/catch-up-subscription.js';
import { verdictToFailureInput } from '../contracts/verdicts/mapping.js';
import { externalVerdictDeliverySchema } from '../contracts/verdicts/schemas.js';

/**
 * The inbound verdict consumer (merge-modular-monolith D3): the cross-module replacement for the
 * retired verdict webhook. Release verdicts arrive over the durable catch-up subscription from
 * the importer module's outbound feed; each event is read tolerantly through the same consumer-
 * owned schema and translated through the same ACL into the native external-validation command,
 * whose decider makes redelivery and staleness converge to no-ops. Events of other types are
 * acknowledged and ignored (the producer may add types freely).
 */
export function verdictEventConsumer(dependencies: UseCaseDependencies): ConsumeHandler {
  return async (event: SeamEvent) => {
    if (event.type !== 'release.verdict') return ok(undefined);

    const parsed = externalVerdictDeliverySchema.safeParse({ data: event.data });
    if (!parsed.success) {
      // A malformed payload of a known type is a producer contract defect, not a passing storm.
      return err({ kind: 'Permanent' as const, reason: 'InvalidPayload' });
    }

    const { acquisitionId, candidate, reasons } = verdictToFailureInput(parsed.data);
    const recorded = await recordExternalValidationFailure(dependencies, acquisitionId, {
      candidate,
      reasons,
    });
    return recorded.match(
      () => ok<void, { kind: 'Transient'; reason: string }>(undefined),
      // Infra faults and append races both heal on redelivery; the decider converges either way.
      (error) => err({ kind: 'Transient' as const, reason: error.kind }),
    );
  };
}
