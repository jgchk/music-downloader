import type { Result } from 'neverthrow';
import type { Logger } from '../logging/logger.js';
import type { DeadLetterStore } from '../ports/dead-letter-port.js';
import type { CheckpointStore } from '../ports/event-store-port.js';

/**
 * The durable catch-up subscription over another module's outbound feed (merge-modular-monolith
 * D3–D7). The subscription owns a named checkpoint in THIS module's store; delivery is
 * at-least-once in global-position order, and the checkpoint always lags the producer — a crash
 * at any point redelivers, and the consumer's idempotent decider converges. The loop is
 * notify-then-poll: an in-process wakeup is a lossy latency hint only; the periodic fallback poll
 * (plus the unconditional startup poll) is the delivery guarantee. Batches are bounded and the
 * loop yields between them.
 *
 * Failure handling per event: a `Transient` failure retries in place with bounded backoff, then
 * holds the checkpoint for the next cycle — delivery is never lost, order preserved (an
 * `IntakeDirectoryMissing`-style fault simply redelivers once the world catches up). A
 * `Permanent` failure (a poison event) applies the subscription's declared policy: `halt` stops
 * the subscription without advancing (structured log; other subscriptions unaffected), `park`
 * records a dead letter in this module's store and advances.
 */

export type PoisonPolicy = 'halt' | 'park';

/** A published event as read from the producing module's feed (consumer-owned shape). */
export interface SeamEvent {
  readonly globalSeq: number;
  readonly type: string;
  readonly timestamp: string;
  readonly data: unknown;
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

export type ConsumeFailure =
  | { readonly kind: 'Transient'; readonly reason: string }
  | { readonly kind: 'Permanent'; readonly reason: string };

export type ConsumeHandler = (event: SeamEvent) => Promise<Result<void, ConsumeFailure>>;

export interface SubscriptionRetryPolicy {
  readonly attempts: number; // in-place attempts per cycle before holding/poisoning
  readonly baseDelayMs: number; // backoff: base * 2^(attempt-1)
}

export interface CatchUpSubscriptionDeps {
  readonly name: string; // the durable checkpoint key, unique per subscription
  readonly feed: SeamFeed;
  readonly checkpoints: CheckpointStore; // THIS module's store — never the producer's
  readonly deadLetters: DeadLetterStore; // THIS module's store
  readonly handler: ConsumeHandler;
  readonly policy: PoisonPolicy;
  readonly logger: Logger;
  readonly clock: { now(): Date };
  readonly retry: SubscriptionRetryPolicy;
  readonly batchSize: number;
  readonly pollIntervalMs: number;
  readonly sleep: (ms: number) => Promise<void>;
  /** The producer's post-commit wakeup — a lossy hint, never the delivery guarantee. */
  readonly wakeups?: { subscribe(listener: () => void): () => void };
  /** Injectable fallback timer (defaults to `setInterval`); returns a stop function. */
  readonly interval?: (fn: () => void, ms: number) => () => void;
}

const defaultInterval = (fn: () => void, ms: number): (() => void) => {
  const handle = setInterval(fn, ms);
  return () => clearInterval(handle);
};

export class CatchUpSubscription {
  private cursor = 0;
  private halted = false;
  private running = false;
  private pending = false;
  private stopWakeups: (() => void) | undefined;
  private stopInterval: (() => void) | undefined;

  constructor(private readonly deps: CatchUpSubscriptionDeps) {}

  /** True when the poison policy has stopped this subscription (checkpoint held). */
  get isHalted(): boolean {
    return this.halted;
  }

  /** Resume from the checkpoint, drain the backlog, then follow wakeups + the fallback poll. */
  async start(): Promise<void> {
    const checkpoint = await this.deps.checkpoints.load(this.deps.name);
    this.cursor = checkpoint.unwrapOr(0);
    await this.poll();
    this.stopWakeups = this.deps.wakeups?.subscribe(() => {
      void this.poll();
    });
    this.stopInterval = (this.deps.interval ?? defaultInterval)(() => {
      void this.poll();
    }, this.deps.pollIntervalMs);
  }

  stop(): void {
    this.stopWakeups?.();
    this.stopWakeups = undefined;
    this.stopInterval?.();
    this.stopInterval = undefined;
  }

  /** Reset the durable checkpoint (replay); takes effect from the next start/poll. */
  async reset(toGlobalSeq = 0): Promise<void> {
    this.cursor = toGlobalSeq;
    this.halted = false;
    await this.deps.checkpoints.save(this.deps.name, toGlobalSeq);
  }

  /** Serialized drain: concurrent calls coalesce into one more pass, never interleave. */
  async poll(): Promise<void> {
    if (this.halted) return;
    if (this.running) {
      this.pending = true;
      return;
    }
    this.running = true;
    try {
      do {
        this.pending = false;
        await this.drain();
      } while (this.pending && !this.halted);
    } finally {
      this.running = false;
    }
  }

  private async drain(): Promise<void> {
    for (;;) {
      const batch = await this.deps.feed.read(this.cursor, this.deps.batchSize);
      if (batch.isErr()) {
        // Feed faults (producer store read, payload rendering) hold the checkpoint; the fallback
        // poll retries — a defective payload is never exposed downstream, never skipped.
        this.deps.logger.error(
          { subscription: this.deps.name, cursor: this.cursor, err: batch.error },
          'seam feed read failed; holding checkpoint',
        );
        return;
      }
      const before = this.cursor;
      for (const event of batch.value.events) {
        if (!(await this.consume(event))) return; // hold or halted: redeliver next cycle/restart
      }
      if (batch.value.scannedTo > this.cursor && !(await this.advance(batch.value.scannedTo))) {
        return;
      }
      if (this.cursor === before) return; // no progress: fully drained
      await this.deps.sleep(0); // yield between batches — better-sqlite3 reads are synchronous
    }
  }

  /** True when the drain may continue past `event`. */
  private async consume(event: SeamEvent): Promise<boolean> {
    const { attempts, baseDelayMs } = this.deps.retry;
    for (let attempt = 1; attempt <= attempts; attempt += 1) {
      const outcome = await this.deps.handler(event);
      if (outcome.isOk()) return this.advance(event.globalSeq);
      if (outcome.error.kind === 'Permanent') {
        // Deterministic failures gain nothing from repetition — straight to the poison policy.
        return this.poison(event, outcome.error.reason);
      }
      this.deps.logger.warn(
        { subscription: this.deps.name, globalSeq: event.globalSeq, attempt, err: outcome.error },
        'seam delivery failed',
      );
      if (attempt < attempts) await this.deps.sleep(baseDelayMs * 2 ** (attempt - 1));
    }
    this.deps.logger.error(
      { subscription: this.deps.name, globalSeq: event.globalSeq },
      'seam delivery exhausted cycle retries; holding checkpoint for redelivery',
    );
    return false;
  }

  /** Apply the declared poison policy; true when the drain may advance past the event. */
  private async poison(event: SeamEvent, reason: string): Promise<boolean> {
    if (this.deps.policy === 'halt') {
      this.halted = true;
      this.deps.logger.error(
        { subscription: this.deps.name, globalSeq: event.globalSeq, reason },
        'poison event; subscription halted, checkpoint held (order over progress)',
      );
      return false;
    }
    const parked = await this.deps.deadLetters.record({
      subscription: this.deps.name,
      globalSeq: event.globalSeq,
      error: reason,
      occurredAt: this.deps.clock.now().toISOString(),
    });
    if (parked.isErr()) {
      this.deps.logger.error(
        { subscription: this.deps.name, globalSeq: event.globalSeq, err: parked.error },
        'dead-letter record failed; holding checkpoint',
      );
      return false;
    }
    this.deps.logger.error(
      { subscription: this.deps.name, globalSeq: event.globalSeq, reason },
      'poison event parked to dead letters; advancing (progress over order)',
    );
    return this.advance(event.globalSeq);
  }

  /** Persist the checkpoint; the cursor never advances past what the consumer has committed. */
  private async advance(toGlobalSeq: number): Promise<boolean> {
    const saved = await this.deps.checkpoints.save(this.deps.name, toGlobalSeq);
    if (saved.isErr()) {
      this.deps.logger.error(
        { subscription: this.deps.name, globalSeq: toGlobalSeq, err: saved.error },
        'checkpoint save failed; holding for redelivery',
      );
      return false;
    }
    this.cursor = toGlobalSeq;
    return true;
  }
}
