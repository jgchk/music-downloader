import { Import } from '../../domain/import/import.js';
import { CONTEXT_NAME, continueFrom, operationScope } from '../correlation/context.js';
import type { OperationScope } from '../correlation/context.js';
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
import type { Clock, CorrelationSource } from '../ports/system-ports.js';
import type { ResultAsync } from 'neverthrow';
import type { Effect } from '../../domain/import/import.js';
import type { CommandError } from './command-handler.js';

/**
 * An effect follow-on that fails is either a transient infrastructure fault — retry it by leaving
 * the checkpoint unadvanced — or a domain rejection (a stale/illegal outcome the stream has already
 * settled), which retrying can never resolve. Only the former is retryable.
 */
/** Exported for its exhaustiveness pin: the union must stay fully classified. */
export function isRetryable(error: CommandError): boolean {
  // Exhaustive over the closed `CommandError` union (no `default`) so a future error variant is a
  // compile-time decision here, not a silent collapse to `false` that would drop a retryable fault.
  switch (error.kind) {
    case 'InfraError':
    case 'ConcurrencyConflict': {
      // A transient infrastructure fault or an optimistic-concurrency race: retrying can resolve it.
      return true;
    }
    case 'CycleInFlight': {
      // A live cycle refuses a new delivery until it settles; retrying is exactly the contract
      // (the reactor never submits imports, so this arm is unreachable from effects — kept for
      // the exhaustive match over the command-error union).
      return true;
    }
    case 'UnknownImport':
    case 'NoOpenReview':
    case 'InvalidResolution':
    case 'UnknownCandidate':
    case 'NoRetainedCandidate': {
      // A domain rejection — the stream has already settled this outcome. Retrying would only
      // re-fire the same rejection forever, so advance past it instead.
      return false;
    }
  }
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
 * held failure that exposure is cleared. Operational logs are correlated by the operation's `correlationId` (plus `streamId` and
 * `globalSeq`), bound once per dispatch in `scopeFor`; the pure
 * `react`/`decide`/`evolve` stay log-free.
 */
export const REACTOR_CONSUMER = 'import-reactor';

/** How the reactor fires one effect — the composition root closes this over the interpreter. */
export type EffectInterpreter = (
  importId: string,
  effect: Effect,
  scope: OperationScope,
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
  /** Mints a story for a stream whose history predates correlation metadata (see `scopeFor`). */
  readonly correlation: CorrelationSource;
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
  private stopped = false;

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
    if (this.stopped) return; // stopped while loading (a backgrounded boot torn down early)
    if (checkpoint.isErr()) {
      // Replaying from the log start is safe (idempotent effects + decide's stale guards) but noisy
      // and slow — the operator must be able to tell it apart from a genuinely fresh consumer.
      this.dependencies.logger.error(
        { err: checkpoint.error },
        'checkpoint load failed; replaying from the log start',
      );
    }
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
    this.stopped = true;
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
        // `pending` is set true by the wakeup path and false here, across an
        // await. TypeScript does not invalidate property narrowing across a call, so it reads the flag as
        // constant — deleting this condition would break wakeup coalescing outright.
        // eslint-disable-next-line @typescript-eslint/no-unnecessary-condition
      } while (this.pending);
    } catch (error: unknown) {
      // Failures inside a pass are values (neverthrow) — an actual throw (a defect in an
      // interpreter closure, or a corrupt event breaking the fold) is a bug. It is contained here
      // so a wakeup-driven `void this.drain()` can never surface as an unhandled process rejection
      // from the durable reactor — in the composed monolith that rejection would terminate the one
      // process serving both modules and the web UI. The checkpoint is untouched, so the pass
      // simply redelivers on the next wakeup or fallback poll.
      this.dependencies.logger.error({ err: error }, 'reactor pass failed unexpectedly');
    } finally {
      this.running = false;
    }
  }

  /**
   * The unit of work one delivered event opens: the story it continues, plus a logger bound to
   * `{correlationId, streamId, globalSeq}` for every line the dispatch emits. Built ONCE per
   * dispatch and handed down — nothing below this point re-derives correlation state, which
   * matters because a degraded row mints a fresh story on each call, so a second `scopeFor` would
   * file the dispatch and its own failure record under two different stories.
   */
  private scopeFor(stored: StoredEvent): OperationScope {
    const { context, origin } = continueFrom(stored, this.dependencies.correlation);
    const scope = operationScope(context, this.dependencies.logger, {
      streamId: stored.streamId,
      globalSeq: stored.globalSeq,
    });
    if (origin === 'absent') {
      // DEBUG: a pre-correlation row can never gain a story, so this says nothing an operator can
      // act on — and a boot drain over historical streams would emit it once per stream.
      scope.logger.debug(
        { context: CONTEXT_NAME },
        'event predates correlation metadata; synthesized a story for this dispatch',
      );
    } else if (origin === 'malformed') {
      // WARN, not debug: every append since this capability shipped goes through a compiler-checked
      // write gate, so a stored story that exists but is unusable means a writer is emitting bad
      // ids RIGHT NOW. That is the opposite of history, and it is actionable.
      scope.logger.warn(
        { context: CONTEXT_NAME, carried: stored.metadata.correlationId },
        'stored correlation id is malformed; synthesized a fresh story — a writer is emitting bad ids',
      );
    }
    return scope;
  }

  async process(stored: StoredEvent): Promise<void> {
    if (stored.globalSeq <= this.lastProcessed) return; // already handled (at-least-once dedupe)

    const scope = this.scopeFor(stored);
    const stream = await this.dependencies.store.readStream(stored.streamId);
    if (stream.isErr()) {
      scope.logger.error(
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
      const result = await this.dependencies.interpret(stored.streamId, effect, scope);
      if (result.isErr()) {
        if (isRetryable(result.error)) {
          if (!(await this.handleRetryable(scope, stored, effect.type, result.error))) return; // held
          // Budget spent: this sibling is dead-lettered — a settled outcome, not a verdict on the
          // effects behind it, which still dispatch before the event advances.
          isDeadLettered = true;
          continue;
        }
        // Stale/illegal outcome — the stream has already settled this sibling; retrying would only
        // re-fire the same rejection forever. Record it and carry on: dropping the effects behind
        // it would silently lose work the event still owes.
        scope.logger.warn(
          { importId: stored.streamId, effect: effect.type, err: result.error },
          'effect follow-on rejected as stale; continuing past it',
        );
        continue;
      }
      scope.logger.debug({ importId: stored.streamId, effect: effect.type }, 'effect dispatched');
    }

    const saved = await this.dependencies.checkpoints.save(REACTOR_CONSUMER, stored.globalSeq);
    if (saved.isErr()) {
      // A failed durable checkpoint write must never be dropped: hold the position (do NOT advance
      // `lastProcessed`) so the event redelivers on the next wakeup/poll, mirroring the
      // subscription's `advance()`. At-least-once tolerates the re-dispatch; the domain's stale
      // guards converge the redelivery.
      scope.logger.error(
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
    scope: OperationScope,
    stored: StoredEvent,
    effectType: string,
    error: CommandError,
  ): Promise<boolean> {
    const existing = await this.dependencies.parked.find(stored.globalSeq);
    if (existing.isErr()) {
      scope.logger.error(
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
        scope.logger.error(
          { importId: stored.streamId, effect: effectType, err: written.error },
          'failed to record retry attempt; holding checkpoint',
        );
        return false;
      }
      scope.logger.error(
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
      scope.logger.error(
        { importId: stored.streamId, effect: effectType, err: recorded.error },
        'dead-letter record failed; holding checkpoint',
      );
      return false;
    }
    this.dependencies.stalled.mark(stored.streamId);
    scope.logger.error(
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
