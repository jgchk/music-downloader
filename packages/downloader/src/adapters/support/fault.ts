import { ZodError } from 'zod';
import { infraError, permanentInfraError } from '../../application/ports/errors.js';
import type { InfraError } from '../../application/ports/errors.js';

/**
 * The adapter-side fault classification seam (reactor-durability D2): single-shot request/response
 * operations wrap thrown causes through this instead of raw `infraError` so permanent conditions
 * are marked at the edge that can recognize them. A response-schema mismatch (zod) is schema
 * drift — the v3.3.1 incident class — and retrying it forever is the wedge this change removes;
 * everything else stays transient and earns backoff.
 *
 * Deliberately NOT applied to long polling loops (the slskd download/abort paths): there a single
 * proxy-mangled payload would be classified permanent and terminate a possibly near-complete
 * candidate on the spot. Those paths stay transient — genuine drift then rides the bounded retry
 * budget and lands visibly, which is exactly what the budget is for.
 */
export function classifiedFault(operation: string, cause: unknown): InfraError {
  return cause instanceof ZodError
    ? permanentInfraError(operation, String(cause), cause)
    : infraError(operation, String(cause), cause);
}
