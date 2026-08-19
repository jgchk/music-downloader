import { CheckpointedDrain } from '@music/eventing';
import type { DrainBatch, DrainFailure, DrainFeed, DrainTuning } from '@music/eventing';
import type { Result } from 'neverthrow';
import type { Logger } from '../logging/logger.js';
import type { InfraError } from '../ports/errors.js';
import type { CheckpointStore } from '../ports/event-store-port.js';

/**
 * This module's catch-up subscription over the other module's outbound feed (merge-modular-monolith
 * D3–D7): a {@link CheckpointedDrain} whose source is the producer's feed. The mechanism — resume,
 * drain, notify-then-poll, hold on transient, halt on poison — lives in `@music/eventing` and is
 * shared; what stays here is this side of the seam: the wire shape this consumer reads, and the
 * translation of the producer's error vocabulary into the drain's classification.
 *
 * The feed is seen STRUCTURALLY, so no cross-module import is needed and no shared model is created.
 */

/** A published event as read from the producing module's feed (consumer-owned shape). */
export interface SeamEvent {
  readonly globalSeq: number;
  readonly type: string;
  readonly timestamp: string;
  readonly data: unknown;
  /**
   * The producer's optional operation-correlation envelope, read tolerantly by the consumer's own
   * schema. Absent when the producer predates the capability — consumption is unaffected; only the
   * trace degrades.
   */
  readonly metadata?: unknown;
}

export interface SeamFeedBatch {
  readonly events: readonly SeamEvent[];
  readonly scannedTo: number;
}

/** The producing module's feed, seen structurally — no cross-module import is needed. */
export interface SeamFeed {
  read(
    fromGlobalSeq: number,
    limit: number,
  ): Promise<Result<SeamFeedBatch, { readonly kind: string }>>;
}

/**
 * How this consumer classifies a delivery failure. Structurally the drain's own classification: a
 * `Transient` failure holds the checkpoint for redelivery, a `Permanent` one is a poison event.
 */
export type ConsumeFailure = DrainFailure;

export type ConsumeHandler = (event: SeamEvent) => Promise<Result<void, ConsumeFailure>>;

/**
 * The one error kind the producer's feed reports that retrying can never resolve: a payload the
 * producer cannot render (a mapping bug, or an event that cannot satisfy its own outbound schema).
 * Everything else is treated as transient and held for the next cycle.
 */
const PERMANENT_FEED_ERROR = 'RenderError';

/** Adapt the producer's feed to the drain's source, translating its error vocabulary. */
function drainFeedOver(feed: SeamFeed): DrainFeed<SeamEvent> {
  return {
    async read(from, limit): Promise<Result<DrainBatch<SeamEvent>, DrainFailure>> {
      const batch = await feed.read(from, limit);
      return batch
        .map(({ events, scannedTo }) => ({ items: events, scannedTo }))
        .mapErr((error): DrainFailure =>
          error.kind === PERMANENT_FEED_ERROR
            ? { kind: 'Permanent', reason: error.kind }
            : { kind: 'Transient', reason: error.kind },
        );
    },
    positionOf: (event) => event.globalSeq,
  };
}

export interface CatchUpSubscriptionDependencies {
  /** The durable checkpoint key, unique per subscription. */
  readonly name: string;
  readonly feed: SeamFeed;
  readonly checkpoints: CheckpointStore; // THIS module's store — never the producer's
  readonly handler: ConsumeHandler;
  readonly logger: Logger;
  /** The producer's post-commit wakeup — a lossy hint, never the delivery guarantee. */
  readonly wakeups?: { subscribe(listener: () => void): () => void };
  /** Test seam only; production takes the drain's defaults. */
  readonly tuning?: Partial<DrainTuning>;
}

/** This module's subscription: the shared drain, bound to this seam's event and error types. */
export type CatchUpSubscription = CheckpointedDrain<SeamEvent, InfraError>;

export function catchUpSubscription(
  dependencies: CatchUpSubscriptionDependencies,
): CatchUpSubscription {
  return new CheckpointedDrain({
    name: dependencies.name,
    feed: drainFeedOver(dependencies.feed),
    checkpoints: dependencies.checkpoints,
    step: dependencies.handler,
    logger: dependencies.logger,
    wakeups: dependencies.wakeups,
    tuning: dependencies.tuning,
  });
}
