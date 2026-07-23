import type { Result } from 'neverthrow';
import type { ImportEventType } from '../../domain/import/events.js';
import type { StoredEvent } from './event-store-port.js';

/**
 * The outbound published-event seam (change: outbound-release-verdicts). Selected domain events
 * are translated into self-contained published payloads, served through the outbound feed to
 * cross-module catch-up subscriptions. The contract (zod schemas, payload rendering) is owned by
 * the interfaces layer; the publisher only needs these shapes, so the mapping is injected behind
 * this port and the dependency rule holds.
 */

/** A rendered outbound event on the pull feed; the payload keeps a self-contained `{type, timestamp, data}` envelope. */
export interface PublishedEvent {
  readonly type: string; // e.g. 'release.verdict'; a breaking change is a NEW type, never a mutation
  readonly timestamp: string; // ISO-8601 — when the domain event occurred (stable across redeliveries)
  readonly data: unknown; // schema-validated payload in the producer's own language
}

/** A payload-rendering defect: deterministic, so the event is never served on the feed (errors are values). */
export interface RenderError {
  readonly kind: 'RenderError';
  readonly eventType: string;
  readonly message: string;
}

/**
 * The producer-owned mapping from stored domain events to published payloads. `publishes` filters
 * the stream; `render` folds the stream prefix (up to and including the event) into a validated
 * payload — deterministic and replay-safe, so redelivery reproduces the first delivery.
 */
export interface PublishedEventMapping {
  publishes(type: ImportEventType): boolean;
  render(stored: StoredEvent, prefix: readonly StoredEvent[]): Result<PublishedEvent, RenderError>;
}
