import type { Brand } from '../../domain/shared/brand.js';
import { branded } from '../../domain/shared/brand.js';

/**
 * The story identifier and its format (change: end-to-end-correlation).
 *
 * A leaf on purpose: the event-store port, the system ports, and both `interfaces/contracts`
 * schemas all need the format, and routing them through `context.js` would make the port and the
 * correlation module import each other. Keeping the id here means the ONE pattern below is the
 * single definition every layer checks against — a schema looser than this predicate would admit a
 * story inbound that this same context then silently drops at its own publish boundary.
 */

/** 32 lowercase hex — the W3C trace-id format, so a later OTel adoption can carry this value. */
export const CORRELATION_ID_PATTERN = /^[0-9a-f]{32}$/;

/**
 * A story id. Branded so a bare string — an aggregate id, a command id — cannot be threaded in
 * where a story belongs. The brand carries the FORMAT too, which is why the only unchecked lift
 * ({@link toCorrelationId}) is documented as trusted and why {@link CorrelationSource} mints
 * this type rather than a raw string.
 */
export type CorrelationId = Brand<string, 'CorrelationId'>;

/** Whether `value` is a well-formed story id (the check every tolerant reader must make). */
export function isCorrelationId(value: string): boolean {
  return CORRELATION_ID_PATTERN.test(value);
}

/**
 * Lift a string already proven to be a well-formed story id into the brand. Trusted — the single
 * sanctioned cast. Call it only behind {@link isCorrelationId}, at the composition root's mint
 * where the format is literally visible, or on a value a boundary schema has validated against
 * {@link CORRELATION_ID_PATTERN}.
 */
export function toCorrelationId(value: string): CorrelationId {
  return branded<CorrelationId>(value);
}
