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
