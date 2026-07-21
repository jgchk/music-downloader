import { err, ok } from 'neverthrow';
import type { Result } from 'neverthrow';
import type { InfraError } from '../ports/errors.js';
import type { EventStorePort } from '../ports/event-store-port.js';
import type { PublishedEventMapping, RenderError } from '../ports/published-events-port.js';

/**
 * The module's outbound event feed (merge-modular-monolith D3): the read side of the cross-module
 * seam. The event store IS the outbox — published events are read from the store in gapless
 * global-position order and rendered through the producer-owned mapping (from the stream prefix
 * as of the event: deterministic, replay-safe). A payload that fails outbound validation is never
 * exposed to a subscription — the read surfaces the defect as an error and the consumer's
 * checkpoint holds. The producer does not know its consumers.
 */

/** One published event on the feed, identified by its gapless global position. */
export interface OutboundFeedEvent {
  readonly globalSeq: number;
  readonly type: string;
  readonly timestamp: string; // ISO-8601 — when the domain event occurred (stable across reads)
  readonly data: unknown;
}

export interface OutboundFeedBatch {
  readonly events: readonly OutboundFeedEvent[];
  /**
   * The highest global position this read scanned (published or not) — the position a consumer
   * may advance its checkpoint to after processing `events`, so trailing unpublished events are
   * not re-scanned forever.
   */
  readonly scannedTo: number;
}

export class OutboundFeed {
  constructor(
    private readonly store: EventStorePort,
    private readonly mapping: PublishedEventMapping,
  ) {}

  /** Up to `limit` published events strictly after `fromGlobalSeq`, in global-position order. */
  async read(
    fromGlobalSeq: number,
    limit: number,
  ): Promise<Result<OutboundFeedBatch, InfraError | RenderError>> {
    const backlog = await this.store.readAll(fromGlobalSeq, limit);
    if (backlog.isErr()) return err(backlog.error);

    const events: OutboundFeedEvent[] = [];
    let scannedTo = fromGlobalSeq;
    for (const stored of backlog.value) {
      scannedTo = stored.globalSeq;
      if (!this.mapping.publishes(stored.type)) continue;

      const stream = await this.store.readStream(stored.streamId);
      if (stream.isErr()) return err(stream.error);
      const prefix = stream.value.filter((entry) => entry.version <= stored.version);
      const rendered = this.mapping.render(stored, prefix);
      if (rendered.isErr()) return err(rendered.error);
      events.push({
        globalSeq: stored.globalSeq,
        type: rendered.value.type,
        timestamp: rendered.value.timestamp,
        data: rendered.value.data,
      });
    }
    return ok({ events, scannedTo });
  }
}
