import { Import } from '../../domain/import/import.js';
import type { Logger } from '../logging/logger.js';
import type { DeadLetterStore } from '../ports/dead-letter-port.js';
import type {
  CheckpointStore,
  EventBus,
  EventStorePort,
  StoredEvent,
} from '../ports/event-store-port.js';
import type { ParkedEffect, ParkedEffectStore } from '../ports/parked-effect-port.js';
import type { StalledReadModel } from '../projections/read-models.js';
import type { Clock } from '../ports/system-ports.js';
import type { ResultAsync } from 'neverthrow';
import type { Effect } from '../../domain/import/import.js';
import type { CommandError } from './command-handler.js';

/**
 * An effect follow-on that fails is either a transient infrastructure fault — retry it by leaving
 * the checkpoint unadvanced — or a domain rejection (a stale/illegal outcome the stream has already
 * settled), which retrying can never resolve. Only the former is retryable.
 */
function isRetryable(error: CommandError): boolean {
  return error.kind === 'InfraError' || error.kind === 'ConcurrencyConflict';
}

/** A one-line rendering of a failed effect's error for a dead-letter or park entry. */
function describeError(error: CommandError): string {
  return error.kind === 'InfraError'
    ? `${error.operation}: ${error.message}`
    : JSON.stringify(error);
}

/**
 * The durable reactor / process manager: the one component that fires real effects, so it must
 * survive crashes without double-firing. It resumes from a durable checkpoint (at-least-once
 * delivery) and advances the checkpoint only once an event is settled — its effect dispatched, its
 * retry budget durably spent, or its follow-on rejected as stale (which retrying can never resolve)
 * — so a restart mid-import does not re-dispatch an already-checkpointed effect.
 *
 * A retryable effect failure HOLDS the single global checkpoint at the failing head and records the
 * attempt tally in a durable {@link ParkedEffectStore} (reactor-durability parity D1): the budget
 * therefore survives restarts, so a poison effect converges on its dead-letter across reboots rather
 * than re-retrying from zero forever. Re-drive is the drain itself — a held event sits at
 * `checkpoint + 1` and is re-processed on the fallback poll and after a restart, with no separate
 * scheduler. When the budget is spent the event is dead-lettered (with its owning stream) and the
 * import is exposed as stalled by the read model (D2); once the stream is reprocessed without a
 * held failure that exposure is cleared. Operational logs are correlated by `importId`; the pure
 * `react`/`decide`/`evolve` stay log-free.
 */
export const REACTOR_CONSUMER = 'import-reactor';

/** How the reactor fires one effect — the composition root closes this over the interpreter. */
export type EffectInterpreter = (
  importId: string,
  effect: Effect,
) => ResultAsync<readonly StoredEvent[], CommandError>;

export interface ReactorDependencies {
  readonly store: EventStorePort;
  readonly checkpoints: CheckpointStore;
  readonly bus: EventBus;
  readonly deadLetters: DeadLetterStore;
  /** Durable retry-budget state, so a poison effect's tally survives restarts (D1). */
  readonly parked: ParkedEffectStore;
  /** The queryable face of dead-lettered imports (D2). */
  readonly stalled: StalledReadModel;
  readonly clock: Clock;
  readonly logger: Logger;
  readonly interpret: EffectInterpreter;
  /** Injectable fallback timer (defaults to `setInterval`); returns a stop function. */
  readonly interval?: (function_: () => void, ms: number) => () => void;
  readonly pollIntervalMs?: number;
  /** How many times one event's effect may fail retryably before it is dead-lettered (D: budget). */
  readonly retryBudget?: number;
}

const DEFAULT_POLL_INTERVAL_MS = 5000;
const DEFAULT_RETRY_BUDGET = 5;

const defaultInterval = (function_: () => void, ms: number): (() => void) => {
  const handle = setInterval(function_, ms);
  return () => {
    clearInterval(handle);
  };
};

export class Reactor {
  private lastProcessed = 0;
  private unsubscribe: (() => void) | undefined;
  private stopInterval: (() => void) | undefined;
  private running = false;
  private pending = false;

  constructor(private readonly dependencies: ReactorDependencies) {}

  private get retryBudget(): number {
    return this.dependencies.retryBudget ?? DEFAULT_RETRY_BUDGET;
  }

  /**
   * Resume from the checkpoint and drain to the head, following live wakeups plus a fallback
   * poll. The bus subscription attaches BEFORE the initial drain: an effect fired from the
   * backlog appends its own follow-on events mid-drain, and a one-shot snapshot-then-subscribe
   * would drop them into the gap between the snapshot and the subscription (a crash-resumed
   * import would stall forever — found by the out-of-process restart e2e). Wakeups are a lossy
   * latency hint; the fallback poll is the delivery guarantee.
   */
  async start(): Promise<void> {
    const checkpoint = await this.dependencies.checkpoints.load(REACTOR_CONSUMER);
    this.lastProcessed = checkpoint.unwrapOr(0);

    this.unsubscribe = this.dependencies.bus.subscribe(() => {
      void this.drain();
    });
    this.stopInterval = (this.dependencies.interval ?? defaultInterval)(() => {
      void this.drain();
    }, this.dependencies.pollIntervalMs ?? DEFAULT_POLL_INTERVAL_MS);

    await this.drain();
  }

  stop(): void {
    this.unsubscribe?.();
    this.unsubscribe = undefined;
    this.stopInterval?.();
    this.stopInterval = undefined;
  }

  /** Serialized catch-up drain from the checkpoint: concurrent wakeups coalesce into one more pass. */
  async drain(): Promise<void> {
    if (this.running) {
      this.pending = true;
      return;
    }
    this.running = true;
    try {
      do {
        this.pending = false;
        const backlog = await this.dependencies.store.readAll(this.lastProcessed);
        if (backlog.isErr()) {
          this.dependencies.logger.error({ err: backlog.error }, 'reactor catch-up failed');
          return;
        }
        for (const stored of backlog.value) {
          await this.process(stored);
          if (this.lastProcessed < stored.globalSeq) {
            // Transient effect failure held the checkpoint: stop here and let the next wakeup or
            // fallback poll retry, instead of hot-looping over the same failing effect.
            return;
          }
        }
      } while (this.pending);
    } finally {
      this.running = false;
    }
  }

  async process(stored: StoredEvent): Promise<void> {
    if (stored.globalSeq <= this.lastProcessed) return; // already handled (at-least-once dedupe)

    const stream = await this.dependencies.store.readStream(stored.streamId);
    if (stream.isErr()) {
      this.dependencies.logger.error(
        { importId: stored.streamId, err: stream.error },
        'reactor stream read failed',
      );
      return;
    }

    // Read before dispatch: a dead-letter inside the dispatch marks the stream stalled, and that
    // fresh exposure must survive this very event — only a PREVIOUSLY stalled stream that now
    // drives successfully is resolved.
    const wasStalled = this.dependencies.stalled.isStalled(stored.streamId);

    // React against the state as of `stored` — the fold of the stream prefix up to and including it
    // — not the whole stream. This keeps `react` a deterministic function of the prefix: a
    // co-emitted or redelivered event sees its own post-state, never a later one.
    const prefix = stream.value.filter((entry) => entry.version <= stored.version);
    const aggregate = Import.fromHistory(prefix.map((entry) => entry.event));
    let isDeadLettered = false;
    for (const effect of aggregate.reactTo(stored.event)) {
      const result = await this.dependencies.interpret(stored.streamId, effect);
      if (result.isErr()) {
        if (isRetryable(result.error)) {
          if (!(await this.handleRetryable(stored, effect.type, result.error))) return; // held
          isDeadLettered = true; // budget spent: dead-lettered — fall through to advance past it
          break;
        }
        // Stale/illegal outcome — the stream has already settled it. Record and advance past
        // it; retrying would only re-fire the same rejection forever.
        this.dependencies.logger.warn(
          { importId: stored.streamId, effect: effect.type, err: result.error },
          'effect follow-on rejected as stale; advancing past it',
        );
        break;
      }
      this.dependencies.logger.debug(
        { importId: stored.streamId, effect: effect.type },
        'effect dispatched',
      );
    }

    const saved = await this.dependencies.checkpoints.save(REACTOR_CONSUMER, stored.globalSeq);
    if (saved.isErr()) {
      // A failed durable checkpoint write must never be dropped: hold the position (do NOT advance
      // `lastProcessed`) so the event redelivers on the next wakeup/poll, mirroring the
      // subscription's `advance()`. At-least-once tolerates the re-dispatch; the domain's stale
      // guards converge the redelivery.
      this.dependencies.logger.error(
        { importId: stored.streamId, globalSeq: stored.globalSeq, err: saved.error },
        'checkpoint save failed; holding for redelivery',
      );
      return;
    }
    await this.clearPark(stored);
    if (!isDeadLettered && wasStalled) await this.clearStalled(stored.streamId);
    this.lastProcessed = stored.globalSeq;
  }

  /**
   * Handle a retryable effect failure against the DURABLE budget: read the event's tally, increment,
   * and below the budget re-park it and hold the checkpoint for a redelivery (returns false). On
   * exhaustion — a deterministic infra fault, e.g. beets refusing this release on every attempt —
   * dead-letter the event (with its owning stream), expose the import as stalled, and let the caller
   * advance past it (returns true), so one poison effect never wedges the whole global queue behind
   * it forever. Because the tally lives in the store, it survives restarts instead of resetting.
   */
  private async handleRetryable(
    stored: StoredEvent,
    effectType: string,
    error: CommandError,
  ): Promise<boolean> {
    const existing = await this.dependencies.parked.find(stored.globalSeq);
    if (existing.isErr()) {
      this.dependencies.logger.error(
        { importId: stored.streamId, effect: effectType, err: existing.error },
        'retry-budget lookup failed; holding checkpoint',
      );
      return false;
    }
    const attempt = (existing.value?.attempt ?? 0) + 1;
    const rendered = `${effectType}: ${describeError(error)}`;

    if (attempt < this.retryBudget) {
      const entry: ParkedEffect = {
        globalSeq: stored.globalSeq,
        streamId: stored.streamId,
        attempt,
        // Preserve the first-failure instant across attempts.
        parkedAt: existing.value?.parkedAt ?? this.dependencies.clock.now().toISOString(),
        lastError: rendered,
      };
      const written = await this.dependencies.parked.park(entry);
      if (written.isErr()) {
        this.dependencies.logger.error(
          { importId: stored.streamId, effect: effectType, err: written.error },
          'failed to record retry attempt; holding checkpoint',
        );
        return false;
      }
      this.dependencies.logger.error(
        { importId: stored.streamId, effect: effectType, attempt, err: error },
        'effect dispatch failed',
      );
      return false;
    }

    const recorded = await this.dependencies.deadLetters.record({
      subscription: REACTOR_CONSUMER,
      globalSeq: stored.globalSeq,
      streamId: stored.streamId,
      error: rendered,
      occurredAt: this.dependencies.clock.now().toISOString(),
    });
    if (recorded.isErr()) {
      this.dependencies.logger.error(
        { importId: stored.streamId, effect: effectType, err: recorded.error },
        'dead-letter record failed; holding checkpoint',
      );
      return false;
    }
    this.dependencies.stalled.mark(stored.streamId);
    this.dependencies.logger.error(
      { importId: stored.streamId, effect: effectType, attempts: attempt, err: error },
      'effect dispatch exhausted retry budget; dead-lettered, import stalled, advancing past it',
    );
    return true;
  }

  /** Drop the resolved event's retry tally (idempotent); a lingering row is harmless but logged. */
  private async clearPark(stored: StoredEvent): Promise<void> {
    const cleared = await this.dependencies.parked.clear(stored.globalSeq);
    if (cleared.isErr()) {
      this.dependencies.logger.error(
        { importId: stored.streamId, globalSeq: stored.globalSeq, err: cleared.error },
        'failed to clear the resolved retry tally',
      );
    }
  }

  /**
   * A previously-stalled import was reprocessed without a held failure (a resubmission, an operator
   * resolution, or any non-failing event of the stream): clear its dead letters and its stalled
   * exposure together. On a clear fault it stays marked — the letters still exist; a later
   * successful event retries the clear.
   */
  private async clearStalled(streamId: string): Promise<void> {
    const cleared = await this.dependencies.deadLetters.clearStream(REACTOR_CONSUMER, streamId);
    if (cleared.isErr()) {
      this.dependencies.logger.error(
        { importId: streamId, err: cleared.error },
        'failed to clear resolved dead letters',
      );
      return;
    }
    this.dependencies.stalled.clear(streamId);
    this.dependencies.logger.info({ importId: streamId }, 'stalled import resumed');
  }
}
