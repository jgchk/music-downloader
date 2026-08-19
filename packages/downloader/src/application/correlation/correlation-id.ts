/**
 * The story identifier and its format, re-exported from the shared mechanism (`@music/eventing`).
 *
 * A leaf on purpose: the event-store port, the system ports, and both `interfaces/contracts` schemas
 * all need the format, and routing them through `context.js` would make the port and the correlation
 * module import each other. The ONE pattern is defined once in `@music/eventing` — a schema looser
 * than its predicate would admit a story inbound that this same context then silently drops at its
 * own publish boundary.
 */
export { CORRELATION_ID_PATTERN, isCorrelationId, toCorrelationId } from '@music/eventing';
export type { CorrelationId } from '@music/eventing';
