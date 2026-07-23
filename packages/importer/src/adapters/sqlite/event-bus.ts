import type { Logger } from '../../application/logging/logger.js';
import type { EventBus, StoredEvent } from '../../application/ports/event-store-port.js';

/**
 * The in-process publish-after-commit fan-out: the event store publishes committed events
 * here, and the reactor and projections subscribe to follow them live within the single process.
 * Fan-out is synchronous. The durable recovery path — after a restart, or for a subscriber that
 * missed live events — is a `readAll` catch-up over the store's global order, not this bus.
 */
export class InProcessEventBus implements EventBus {
  private readonly handlers = new Set<(event: StoredEvent) => void>();

  constructor(private readonly logger: Logger) {}

  publish(events: readonly StoredEvent[]): void {
    for (const event of events) {
      for (const handler of this.handlers) {
        try {
          handler(event);
        } catch (error) {
          // A subscriber that throws must never abort the fan-out — its peers still owe delivery —
          // nor bubble out of publish-after-commit to fail an already-committed append. Log and
          // carry on; the durable catch-up (`readAll`) is the delivery guarantee regardless.
          this.logger.error(
            { err: error, globalSeq: event.globalSeq },
            'event-bus subscriber threw; isolated',
          );
        }
      }
    }
  }

  subscribe(handler: (event: StoredEvent) => void): () => void {
    this.handlers.add(handler);
    return () => this.handlers.delete(handler);
  }
}
