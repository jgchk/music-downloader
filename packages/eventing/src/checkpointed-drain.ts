import { ResultAsync } from 'neverthrow';
import type { Result } from 'neverthrow';

/**
 * The durable checkpointed drain: resume from a consumer-owned checkpoint, drain to the head of an
 * ordered feed, and never advance past work whose effects are not committed. Delivery is
 * at-least-once in position order and the checkpoint always lags the producer — a crash at any
 * point redelivers, and an idempotent consumer converges.
 *
 * The loop is notify-then-poll: a wakeup is a lossy latency hint only; the periodic fallback poll
 * (plus the unconditional poll at start) is the delivery guarantee. Batches are bounded and the
 * loop yields between them.
 *
 * Failure handling per item: a `Transient` failure retries in place with bounded backoff, then
 * holds the checkpoint for the next cycle — delivery is never lost and order is preserved. A
 * `Permanent` failure (a poison item) halts: the drain stops without advancing, the stall is
 * logged, and other drains are unaffected. Recovery is a restart once the defect is fixed — which
 * replays from the held checkpoint, in order — or an explicit `reset` to a chosen position.
 *
 * This module is generic mechanism by rule: it carries no vocabulary from any consumer, and every
 * identity it handles (the checkpoint key, an item's position) arrives as an opaque parameter. See
 * `openspec/changes/extract-eventing-package/design.md` D1–D4 — in particular D4 for why
 * `halt` is the only poison policy and what a future per-stream `park` arm would attach to.
 */

/**
 * How a failure is classified, by the consumer that produced it. This is the load-bearing wall of
 * the halt-only policy: `Transient` holds for redelivery forever, `Permanent` stops the drain.
 *
 * `cause` carries the consumer's OWN error through untouched, and a classifier that drops it is a
 * defect: `kind` and `reason` tell an operator only what readiness already told them, while the
 * field that names the actual fault — which event type failed to render, which store call faulted —
 * lives in the error the classifier was handed. A halted seam whose log says only "Permanent" has
 * surfaced the stall and hidden the fix.
 */
export type DrainFailure =
  | { readonly kind: 'Transient'; readonly reason: string; readonly cause?: unknown }
  | { readonly kind: 'Permanent'; readonly reason: string; readonly cause?: unknown };

export interface DrainBatch<TItem> {
  readonly items: readonly TItem[];
  /**
   * The highest position this read examined, published or not. It is what lets the checkpoint move
   * past a run of positions the producer never published, instead of stalling behind the gap.
   */
  readonly scannedTo: number;
}

/**
 * The ordered source. `positionOf` keeps the drain free of any assumption about an item's shape:
 * the consumer names its own position field.
 */
export interface DrainFeed<TItem> {
  read(from: number, limit: number): Promise<Result<DrainBatch<TItem>, DrainFailure>>;
  positionOf(item: TItem): number;
}

/** The consumer's own durable checkpoint store, generic in the error type it reports. */
export interface DrainCheckpointStore<TError> {
  load(consumer: string): ResultAsync<number, TError>; // 0 when never checkpointed
  save(consumer: string, position: number): ResultAsync<void, TError>;
}

/** The structural slice of a structured logger this module uses (pino-compatible). */
export interface DrainLogger {
  warn(payload: object, message: string): void;
  error(payload: object, message: string): void;
}

/** A defect escaping the store as a rejection rather than a modeled error. */
export interface DrainDefect {
  readonly kind: 'DrainDefect';
  readonly operation: string;
  readonly message: string;
  readonly cause?: unknown;
}

/**
 * Everything that has never varied across this module's consumers. Production supplies none of it; a
 * test reaches determinism through `sleep`/`interval` here rather than through the interface every
 * caller must learn.
 */
export interface DrainTuning {
  /** In-place attempts per cycle before holding; backoff is `baseDelayMs * 2^(attempt-1)`. */
  readonly retry: { readonly attempts: number; readonly baseDelayMs: number };
  readonly batchSize: number;
  readonly pollIntervalMs: number;
  readonly sleep: (ms: number) => Promise<void>;
  /** Returns its own stop function. */
  readonly interval: (function_: () => void, ms: number) => () => void;
}

export const DEFAULT_DRAIN_TUNING: DrainTuning = {
  retry: { attempts: 3, baseDelayMs: 250 },
  batchSize: 100,
  pollIntervalMs: 5000,
  sleep: (ms) =>
    new Promise((resolve) => {
      setTimeout(resolve, ms);
    }),
  interval: (function_, ms) => {
    const handle = setInterval(function_, ms);
    return () => {
      clearInterval(handle);
    };
  },
};

export interface CheckpointedDrainDependencies<TItem, TError> {
  /** The durable checkpoint key, unique per drain. Opaque to this module. */
  readonly name: string;
  readonly feed: DrainFeed<TItem>;
  /** The CONSUMER's store — never the producer's. */
  readonly checkpoints: DrainCheckpointStore<TError>;
  readonly step: (item: TItem) => Promise<Result<void, DrainFailure>>;
  readonly logger: DrainLogger;
  /**
   * Translate a defect — a store that REJECTS instead of answering with a Result — into the
   * consumer's own error type. Required, not optional: without it this module's `DrainDefect` would
   * travel a channel the consumer declared as its own error union, and a caller narrowing on that
   * union would fall through at runtime on a variant its module never declared.
   */
  readonly mapDefect: (defect: DrainDefect) => TError;
  /** The producer's post-commit wakeup — a lossy hint, never the delivery guarantee. */
  readonly wakeups?: { subscribe(listener: () => void): () => void };
  readonly tuning?: Partial<DrainTuning>;
}

/**
 * Mark a drain cycle as SETTLED for the stop and reset barriers without adopting its outcome. A
 * defect throw from the cycle stays the awaiting `poll` caller's to handle (it re-raises there);
 * this copy exists only so a barrier can tell when the drain has stopped touching the checkpoint,
 * and swallowing the rejection *here* is what keeps the barrier from surfacing as an unhandled
 * rejection of its own.
 */
/**
 * The single place a classification decides the drain's behaviour. Exhaustive on purpose: D4 records
 * that a future per-stream `park` arm attaches here, and an `if (kind === 'Permanent')` would route
 * that new arm to hold-and-retry-forever in silence. Adding a variant breaks the build here instead.
 */
function isPermanent(failure: DrainFailure): boolean {
  // Enumerated exhaustively with NO `default`: a new variant stops satisfying the declared `boolean`
  // return and breaks the build here, which is the pin. A `default` arm would be the same claim
  // written as an unreachable runtime branch that no test could ever cover.
  switch (failure.kind) {
    case 'Permanent': {
      return true;
    }
    case 'Transient': {
      return false;
    }
  }
}

const settled = async (work: Promise<unknown>): Promise<void> => {
  try {
    await work;
  } catch {
    // Deliberately not handled here — see above.
  }
};

export class CheckpointedDrain<TItem, TError> {
  private cursor = 0;
  private halted = false;
  private running = false;
  // Stryker disable next-line BooleanLiteral: the initializer is never read. `runCycles` assigns
  // `pending = false` at the top of every iteration, and its `while` test is the field's only
  // reader — so every read is preceded by that assignment and no initial value can reach one.
  // A value is required here only because the field is declared non-optional.
  private pending = false;
  private resets = 0;
  private resetQueue: Promise<void> = Promise.resolve();
  private inflight: Promise<void> | undefined;
  private stopWakeups: (() => void) | undefined;
  private stopInterval: (() => void) | undefined;
  private readonly tuning: DrainTuning;

  constructor(private readonly dependencies: CheckpointedDrainDependencies<TItem, TError>) {
    this.tuning = { ...DEFAULT_DRAIN_TUNING, ...dependencies.tuning };
  }

  /**
   * True when this drain has stopped delivering — a poison item, an unreadable checkpoint at start,
   * or a permanent feed defect. The checkpoint is held in every case, so the consuming module can
   * report itself degraded rather than silently idle.
   */
  get isHalted(): boolean {
    return this.halted;
  }

  /** Resume from the checkpoint, drain the backlog, then follow wakeups plus the fallback poll. */
  async start(): Promise<void> {
    const checkpoint = await this.dependencies.checkpoints.load(this.dependencies.name);
    if (checkpoint.isErr()) {
      // The checkpoint is the only record of what this consumer has already seen, so a faulted read
      // knows nothing — collapsing it into "fresh consumer at 0" would assert a durable fact and
      // redeliver the producer's entire history while the consuming module still reported itself
      // healthy. Halt on the unknown position instead: nothing is delivered and the durable
      // checkpoint is left untouched.
      // Recovery is a restart once the store reads, or an explicit `reset` to a chosen position —
      // never a guess. The wakeup and poll wiring below still registers, so a `reset` that lands on
      // a recovered store resumes delivery without a restart.
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
    this.stopInterval = this.tuning.interval(() => {
      this.schedulePoll();
    }, this.tuning.pollIntervalMs);
  }

  /**
   * Fire-and-forget a poll from a wakeup or the fallback timer. `poll` handles modeled failures as
   * values; an actual throw (a defect in the feed or step) is a bug, caught and logged here so a
   * lone bad cycle can never surface as an unhandled process rejection from a durable drain — in a
   * composed monolith that rejection would take down the one process serving every module.
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
   * touching the store. Detaching alone only cancels the NEXT cycle: the caller closes the store
   * handle immediately after this resolves, so a cycle still draining would go on reading the feed
   * and saving checkpoints against a closed database — the very error loop the detach exists to
   * prevent, one cycle later. `inflight` is the settled barrier, so it never rejects.
   */
  async stop(): Promise<void> {
    this.stopWakeups?.();
    this.stopWakeups = undefined;
    this.stopInterval?.();
    this.stopInterval = undefined;
    // BOTH writers, not just the drain: a queued reset saves the checkpoint too, and with no cycle
    // running `inflight` is undefined — so awaiting it alone would resolve while a reset's save was
    // still in flight, against a handle the caller closes the moment this resolves. Neither promise
    // rejects; both are settled barriers.
    await Promise.all([this.inflight, this.resetQueue]);
  }

  /**
   * Reset the durable checkpoint (replay); takes effect from the next start/poll. The durable
   * checkpoint is the source of truth, so the save happens first and the in-memory cursor and halt
   * move only once it lands: an operator who is told the replay was armed must never be looking at
   * a drain that will resume from the old position on the next restart.
   *
   * Serialized against the drain — an in-flight cycle is awaited out and no new one may start while
   * the save is in flight. Unserialized, an `advance` landing just behind the save would leave the
   * durable checkpoint ahead of `toPosition` while this call reported `Ok`, which is exactly the
   * false "replay armed" the ordering above exists to prevent.
   */
  reset(toPosition = 0): ResultAsync<void, TError> {
    // Queued, not flagged: a boolean gate would be cleared by whichever of two overlapping resets
    // finished first, re-admitting the drain while the other's save was still in flight — the same
    // falsified Ok this serialization exists to prevent. `fromPromise`, not `new ResultAsync`: the
    // latter does not catch, so a rejecting store would escape this declared error channel.
    this.resets += 1;
    const run = this.resetAfter(this.resetQueue, toPosition);
    this.resetQueue = settled(run);
    return ResultAsync.fromPromise(run, (error): TError =>
      this.dependencies.mapDefect({
        kind: 'DrainDefect',
        operation: 'checkpoint.reset',
        message: 'checkpoint reset failed unexpectedly',
        cause: error,
      }),
    ).andThen((saved) => saved);
  }

  private async resetAfter(
    previous: Promise<void>,
    toPosition: number,
  ): Promise<Result<void, TError>> {
    try {
      await previous; // this reset's turn in the queue
      await this.inflight; // and the drain has stopped touching the checkpoint
      const saved = await this.dependencies.checkpoints.save(this.dependencies.name, toPosition);
      if (saved.isErr()) {
        this.dependencies.logger.error(
          { subscription: this.dependencies.name, position: toPosition, err: saved.error },
          'checkpoint reset failed; replay not armed',
        );
        return saved;
      }
      this.cursor = toPosition;
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
      // `pending` is set true by the wakeup path and false here, across an await. TypeScript does
      // not invalidate property narrowing across a call, so it reads the flag as constant —
      // deleting this condition would break wakeup coalescing outright. The directive necessarily
      // covers BOTH operands, so a `halted` that ever went genuinely constant would be hidden here
      // too; it is checked by the halt tests rather than by this rule.
      // eslint-disable-next-line @typescript-eslint/no-unnecessary-condition
    } while (this.pending && !this.halted);
  }

  private async drain(): Promise<void> {
    for (;;) {
      const batch = await this.dependencies.feed.read(this.cursor, this.tuning.batchSize);
      if (batch.isErr()) {
        if (isPermanent(batch.error)) {
          // A permanent defect at the producer (a mapping bug, or an item that cannot satisfy its
          // schema): retrying can never resolve it, so a plain hold would block this position — and
          // every item behind it — forever while the consuming module still reported itself
          // healthy. Halt loudly: the checkpoint is held (never skipped), surfacing it for the code
          // fix a defect needs.
          this.halted = true;
          this.dependencies.logger.error(
            { subscription: this.dependencies.name, cursor: this.cursor, err: batch.error },
            'seam feed render defect (permanent); subscription halted, checkpoint held',
          );
          return;
        }
        // A transient read fault holds the checkpoint; the fallback poll retries — a defective batch
        // is never exposed downstream, never skipped.
        this.dependencies.logger.error(
          { subscription: this.dependencies.name, cursor: this.cursor, err: batch.error },
          'seam feed read failed; holding checkpoint',
        );
        return;
      }
      const before = this.cursor;
      for (const item of batch.value.items) {
        if (!(await this.consume(item))) return; // hold or halted: redeliver next cycle/restart
      }
      if (batch.value.scannedTo > this.cursor && !(await this.advance(batch.value.scannedTo))) {
        return;
      }
      if (this.cursor === before) return; // no progress: fully drained
      await this.tuning.sleep(0); // yield between batches — synchronous store reads block the loop
    }
  }

  /** True when the drain may continue past `item`. */
  private async consume(item: TItem): Promise<boolean> {
    const { attempts, baseDelayMs } = this.tuning.retry;
    const position = this.dependencies.feed.positionOf(item);
    let lastError: unknown;
    for (let attempt = 1; attempt <= attempts; attempt += 1) {
      const outcome = await this.dependencies.step(item);
      if (outcome.isOk()) return this.advance(position);
      lastError = outcome.error;
      if (isPermanent(outcome.error)) {
        // Deterministic failures gain nothing from repetition — straight to the poison policy.
        return this.poison(position, outcome.error.reason);
      }
      this.dependencies.logger.warn(
        { subscription: this.dependencies.name, position, attempt, err: outcome.error },
        'seam delivery failed',
      );
      if (attempt < attempts) await this.tuning.sleep(baseDelayMs * 2 ** (attempt - 1));
    }
    // The sustained operator signal for a standing hold: it must carry the failure itself, or a
    // wedged seam logs an error line that never says why.
    this.dependencies.logger.error(
      { subscription: this.dependencies.name, position, err: lastError },
      'seam delivery exhausted cycle retries; holding checkpoint for redelivery',
    );
    return false;
  }

  /**
   * The poison policy: halt, always. Order over progress — the checkpoint is held so a fix-and-
   * restart replays this position and everything behind it, in order. See design D4 for why the
   * dead-letter-and-advance ("park") alternative is not offered, and what a per-stream variant
   * would have to attach to here.
   */
  private poison(position: number, reason: string): boolean {
    this.halted = true;
    this.dependencies.logger.error(
      { subscription: this.dependencies.name, position, reason },
      'poison event; subscription halted, checkpoint held (order over progress)',
    );
    return false;
  }

  /**
   * Persist the checkpoint; the cursor never advances past what the consumer has committed — and
   * never moves BACKWARD. A feed whose positions are not strictly ascending would otherwise drive the
   * durable checkpoint down and redeliver the same window forever, and `drain`'s `cursor === before`
   * exit would not catch it, because the cursor did move. That is a producer defect no retry can
   * fix, so it halts on the same terms as a poison item rather than quietly re-reading.
   */
  private async advance(toPosition: number): Promise<boolean> {
    if (toPosition <= this.cursor) {
      this.halted = true;
      this.dependencies.logger.error(
        { subscription: this.dependencies.name, cursor: this.cursor, position: toPosition },
        'feed reported a position at or behind the checkpoint; drain halted (positions must ascend)',
      );
      return false;
    }
    const saved = await this.dependencies.checkpoints.save(this.dependencies.name, toPosition);
    if (saved.isErr()) {
      this.dependencies.logger.error(
        { subscription: this.dependencies.name, position: toPosition, err: saved.error },
        'checkpoint save failed; holding for redelivery',
      );
      return false;
    }
    this.cursor = toPosition;
    return true;
  }
}
