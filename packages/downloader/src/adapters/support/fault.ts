import { ZodError } from 'zod';
import { infraError, permanentInfraError } from '../../application/ports/errors.js';
import type { InfraError } from '../../application/ports/errors.js';

/**
 * The adapter-side fault classification seam (reactor-durability D2): network adapters wrap thrown
 * causes through this instead of raw `infraError` so permanent conditions are marked at the edge
 * that can recognize them. A response-schema mismatch (zod) is schema drift — the v3.3.1 incident
 * class — and retrying it forever is the wedge this change removes; everything else stays
 * transient and earns backoff.
 */
export function classifiedFault(operation: string, cause: unknown): InfraError {
  return cause instanceof ZodError
    ? permanentInfraError(operation, String(cause), cause)
    : infraError(operation, String(cause), cause);
}
