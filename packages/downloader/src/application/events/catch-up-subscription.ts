import { ResultAsync } from 'neverthrow';
import type { Result } from 'neverthrow';
import type { Logger } from '../logging/logger.js';
import { infraError } from '../ports/errors.js';
import type { InfraError } from '../ports/errors.js';
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

export type ConsumeFailure =
  | { readonly kind: 'Transient'; readonly reason: string }
  | { readonly kind: 'Permanent'; readonly reason: string };

export type ConsumeHandler = (event: SeamEvent) => Promise<Result<void, ConsumeFailure>>;

export interface SubscriptionRetryPolicy {
  readonly attempts: number; // in-place attempts per cycle before holding/poisoning
  readonly baseDelayMs: number; // backoff: base * 2^(attempt-1)
}

export interface CatchUpSubscriptionDependencies {
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
  readonly interval?: (function_: () => void, ms: number) => () => void;
}

/**
 * Mark a drain cycle as SETTLED for the reset barrier without adopting its outcome. A defect throw
 * from the cycle stays the awaiting `poll` caller's to handle (it re-raises there); this copy exists
 * only so a reset can tell when the drain has stopped touching the checkpoint, and swallowing the
 * rejection *here* is what keeps the barrier from surfacing as an unhandled rejection of its own.
 */
const settled = async (work: Promise<unknown>): Promise<void> => {
  try {
    await work;
  } catch {
    // Deliberately not handled here — see above.
  }
};

const defaultInterval = (function_: () => void, ms: number): (() => void) => {
  const handle = setInterval(function_, ms);
  return () => clearInterval(handle);
};

export class CatchUpSubscription {
  private cursor = 0;
  private halted = false;
  private running = false;
  // Stryker disable next-line BooleanLiteral: equivalent — `runCycles()` assigns `pending = false`
  // at the top of its loop before anything reads it, so this initialiser is never observed. The
  // field needs an initialiser (strict property initialisation), so there is nothing to delete.
  private pending = false;
  private resets = 0;
  private resetQueue: Promise<void> = Promise.resolve();
  private inflight: Promise<void> | undefined;
  private stopWakeups: (() => void) | undefined;
  private stopInterval: (() => void) | undefined;

  constructor(private readonly dependencies: CatchUpSubscriptionDependencies) {}

  /**
   * True when this subscription has stopped delivering — a poison event under the `halt` policy,
   * an unreadable checkpoint at start, or a permanent feed render defect. The checkpoint is held
   * in every case, and the module reports readiness `down`.
   */
  get isHalted(): boolean {
    return this.halted;
  }

  /** Resume from the checkpoint, drain the backlog, then follow wakeups + the fallback poll. */
  async start(): Promise<void> {
    const checkpoint = await this.dependencies.checkpoints.load(this.dependencies.name);
    if (checkpoint.isErr()) {
      // The checkpoint is the only record of what this consumer has already seen, so a faulted
      // read knows nothing — collapsing it into "fresh consumer at 0" would assert a durable fact
      // and redeliver the producer's entire history while readiness still read `up`. Halt on the
      // unknown position instead: nothing is delivered, the durable checkpoint is left untouched,
      // and this module's readiness reports `down` (the same loud-but-contained signal a poison
      // event raises) so an operator sees a degraded module rather than a silent full replay.
      // Recovery is a restart once the store reads, or an explicit `reset` to a chosen position —
      // never a guess. The wakeup and poll wiring below still registers, so a `reset` that lands
      // on a recovered store resumes delivery without a restart.
      this.halted = true;
      this.dependencies.logger.error(
        { subscription: this.dependencies.name, err: checkpoint.error },
        'checkpoint load failed; subscription halted without delivering (position unknown)',
      );
    } else {
      this.cursor = checkpoint.value;
    }
    await this.poll(); // a no-op while halted: the drain never runs on an unknown position
    this.stopWakeups = this.dependencies.wakeups?.subscribe(() => {
      this.schedulePoll();
    });
    this.stopInterval = (this.dependencies.interval ?? defaultInterval)(() => {
      this.schedulePoll();
    }, this.dependencies.pollIntervalMs);
  }

  /**
   * Fire-and-forget a poll from a wakeup or the fallback timer. `poll` handles modeled failures as
   * values; an actual throw (a defect in the feed or handler) is a bug, caught and logged here so a
   * lone bad cycle can never surface as an unhandled process rejection from a durable subscription.
   */
  private schedulePoll(): void {
    void this.poll().catch((error: unknown) => {
      this.dependencies.logger.error(
        { subscription: this.dependencies.name, err: error },
        'seam subscription poll failed unexpectedly',
      );
    });
  }

  /**
   * Detach the wakeup listener and the fallback timer, then wait for any in-flight drain to stop
   * touching the store. Detaching alone only cancels the NEXT cycle: the caller closes the
   * event-store handle immediately after this resolves, so a cycle still draining would go on
   * reading the feed and saving checkpoints against a closed database — the very error loop the detach
   * exists to prevent, one cycle later. `inflight` is the settled barrier, so it never rejects.
   */
  async stop(): Promise<void> {
    this.stopWakeups?.();
    this.stopWakeups = undefined;
    this.stopInterval?.();
    this.stopInterval = undefined;
    await this.inflight;
  }

  /**
   * Reset the durable checkpoint (replay); takes effect from the next start/poll. The durable
   * checkpoint is the source of truth, so the save happens first and the in-memory cursor and halt
   * move only once it lands: an operator who is told the replay was armed must never be looking at
   * a subscription that will resume from the old position on the next restart.
   *
   * Serialized against the drain — an in-flight cycle is awaited out and no new one may start
   * while the save is in flight. Unserialized, an `advance` landing just behind the save would
   * leave the durable checkpoint ahead of `toGlobalSeq` while this call reported `Ok`, which is
   * exactly the false "replay armed" the ordering above exists to prevent.
   */
  reset(toGlobalSeq = 0): ResultAsync<void, InfraError> {
    // Queued, not flagged: a boolean gate would be cleared by whichever of two overlapping resets
    // finished first, re-admitting the drain while the other's save was still in flight — the same
    // falsified Ok this serialization exists to prevent. `fromPromise`, not `new ResultAsync`: the
    // latter does not catch, so a rejecting store would escape this declared error channel.
    this.resets += 1;
    const run = this.resetAfter(this.resetQueue, toGlobalSeq);
    this.resetQueue = settled(run);
    return ResultAsync.fromPromise(run, (error) =>
      infraError('checkpoint.reset', 'checkpoint reset failed unexpectedly', error),
    ).andThen((saved) => saved);
  }

  private async resetAfter(
    previous: Promise<void>,
    toGlobalSeq: number,
  ): Promise<Result<void, InfraError>> {
    try {
      await previous; // this reset's turn in the queue
      await this.inflight; // and the drain has stopped touching the checkpoint
      const saved = await this.dependencies.checkpoints.save(this.dependencies.name, toGlobalSeq);
      if (saved.isErr()) {
        this.dependencies.logger.error(
          { subscription: this.dependencies.name, globalSeq: toGlobalSeq, err: saved.error },
          'checkpoint reset failed; replay not armed',
        );
        return saved;
      }
      this.cursor = toGlobalSeq;
      this.halted = false;
      return saved;
    } finally {
      this.resets -= 1;
    }
  }

  /** Serialized drain: concurrent calls coalesce into one more pass, never interleave. */
  async poll(): Promise<void> {
    if (this.halted || this.resets > 0) return;
    if (this.running) {
      this.pending = true;
      return;
    }
    this.running = true;
    const cycles = this.runCycles();
    this.inflight = settled(cycles);
    try {
      await cycles;
    } finally {
      this.running = false;
      this.inflight = undefined;
    }
  }

  private async runCycles(): Promise<void> {
    do {
      this.pending = false;
      await this.drain();
      // `pending` is set true by the wakeup path and false here, across an
      // await. TypeScript does not invalidate property narrowing across a call, so it reads the flag as
      // constant — deleting this condition would break wakeup coalescing outright. The directive
      // necessarily covers BOTH operands, so a `halted` that ever went genuinely constant would be
      // hidden here too; it is checked by the halt tests rather than by this rule.
      // eslint-disable-next-line @typescript-eslint/no-unnecessary-condition
    } while (this.pending && !this.halted);
  }

  private async drain(): Promise<void> {
    for (;;) {
      const batch = await this.dependencies.feed.read(this.cursor, this.dependencies.batchSize);
      if (batch.isErr()) {
        if (batch.error.kind === 'RenderError') {
          // A permanent payload-rendering defect at the producer (a mapping bug, or an event that
          // cannot satisfy its schema): retrying can never resolve it, so a plain hold would block
          // this position — and every event behind it — forever while readiness still read `up`.
          // Halt loudly: the checkpoint is held (never skipped) and readiness reports `down`,
          // surfacing it for the code fix a render defect actually needs. (Precise per-event
          // dead-lettering for a `park` consumer would need the feed to carry the failing global
          // position; the seam error only exposes `kind`, so that is deferred.)
          this.halted = true;
          this.dependencies.logger.error(
            { subscription: this.dependencies.name, cursor: this.cursor, err: batch.error },
            'seam feed render defect (permanent); subscription halted, checkpoint held',
          );
          return;
        }
        // A transient store-read fault holds the checkpoint; the fallback poll retries — a
        // defective batch is never exposed downstream, never skipped.
        this.dependencies.logger.error(
          { subscription: this.dependencies.name, cursor: this.cursor, err: batch.error },
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
      await this.dependencies.sleep(0); // yield between batches — better-sqlite3 reads are synchronous
    }
  }

  /** True when the drain may continue past `event`. */
  private async consume(event: SeamEvent): Promise<boolean> {
    const { attempts, baseDelayMs } = this.dependencies.retry;
    let lastError: unknown;
    for (let attempt = 1; attempt <= attempts; attempt += 1) {
      const outcome = await this.dependencies.handler(event);
      if (outcome.isOk()) return this.advance(event.globalSeq);
      lastError = outcome.error;
      if (outcome.error.kind === 'Permanent') {
        // Deterministic failures gain nothing from repetition — straight to the poison policy.
        return this.poison(event, outcome.error.reason);
      }
      this.dependencies.logger.warn(
        {
          subscription: this.dependencies.name,
          globalSeq: event.globalSeq,
          attempt,
          err: outcome.error,
        },
        'seam delivery failed',
      );
      if (attempt < attempts) await this.dependencies.sleep(baseDelayMs * 2 ** (attempt - 1));
    }
    // The sustained operator signal for a standing hold: it must carry the failure itself,
    // or a wedged seam logs an error line that never says why.
    this.dependencies.logger.error(
      { subscription: this.dependencies.name, globalSeq: event.globalSeq, err: lastError },
      'seam delivery exhausted cycle retries; holding checkpoint for redelivery',
    );
    return false;
  }

  /** Apply the declared poison policy; true when the drain may advance past the event. */
  private async poison(event: SeamEvent, reason: string): Promise<boolean> {
    if (this.dependencies.policy === 'halt') {
      this.halted = true;
      this.dependencies.logger.error(
        { subscription: this.dependencies.name, globalSeq: event.globalSeq, reason },
        'poison event; subscription halted, checkpoint held (order over progress)',
      );
      return false;
    }
    const parked = await this.dependencies.deadLetters.record({
      subscription: this.dependencies.name,
      globalSeq: event.globalSeq,
      error: reason,
      occurredAt: this.dependencies.clock.now().toISOString(),
    });
    if (parked.isErr()) {
      this.dependencies.logger.error(
        { subscription: this.dependencies.name, globalSeq: event.globalSeq, err: parked.error },
        'dead-letter record failed; holding checkpoint',
      );
      return false;
    }
    this.dependencies.logger.error(
      { subscription: this.dependencies.name, globalSeq: event.globalSeq, reason },
      'poison event parked to dead letters; advancing (progress over order)',
    );
    return this.advance(event.globalSeq);
  }

  /** Persist the checkpoint; the cursor never advances past what the consumer has committed. */
  private async advance(toGlobalSeq: number): Promise<boolean> {
    const saved = await this.dependencies.checkpoints.save(this.dependencies.name, toGlobalSeq);
    if (saved.isErr()) {
      this.dependencies.logger.error(
        { subscription: this.dependencies.name, globalSeq: toGlobalSeq, err: saved.error },
        'checkpoint save failed; holding for redelivery',
      );
      return false;
    }
    this.cursor = toGlobalSeq;
    return true;
  }
}
