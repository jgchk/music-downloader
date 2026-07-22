import { Acquisition } from '../../domain/acquisition/acquisition.js';
import type { Effect } from '../../domain/acquisition/acquisition.js';
import type { AcquisitionCommand } from '../../domain/acquisition/commands.js';
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
import { applyCommand } from './command-handler.js';
import type { CommandError } from './command-handler.js';
import { interpretEffect } from './interpreter.js';
import type { InterpreterDeps } from './interpreter.js';
import { DEFAULT_RETRY_POLICY, nextRetry } from './retry-policy.js';
import type { RetryPolicy } from './retry-policy.js';

/**
 * Effect-failure classification (reactor-durability D2): a transient infrastructure fault or a
 * concurrency conflict earns backoff; a permanent fault the adapter recognized short-circuits the
 * budget and lands immediately; a domain rejection is a stale/illegal outcome the stream has
 * already settled — advance past it.
 */
function isRetryable(error: CommandError): boolean {
  return (
    (error.kind === 'InfraError' && error.permanent !== true) ||
    error.kind === 'ConcurrencyConflict'
  );
}

function isPermanentFault(error: CommandError): boolean {
  return error.kind === 'InfraError' && error.permanent === true;
}

function describeError(error: CommandError): string {
  return error.kind === 'InfraError'
    ? `${error.operation}: ${error.message}`
    : JSON.stringify(error);
}

/**
 * The modeled landing for a budget-exhausted (or permanently failed) effect: degrade to the
 * effect's business failure through the normal command path where one exists (D2). Effects with
 * no modeled failure return undefined and dead-letter instead.
 */
function degradeCommand(effect: Effect): AcquisitionCommand | undefined {
  switch (effect.type) {
    case 'ResolveMetadata':
      return { type: 'RecordMetadataFailed' };
    case 'Download':
      // Hours without progress IS a stalled download; the rejection advances the candidate ladder.
      return { type: 'RecordDownloadFailed', reason: 'Stalled' };
    case 'AbortDownload':
      // The abort's settlement: reject the pending candidate as the interpreter would have.
      return { type: 'RecordDownloadFailed', reason: 'Cancelled' };
    default:
      // Search, Validate, Import, Cleanup: no modeled failure to degrade to — dead-letter.
      return undefined;
  }
}

type DispatchOutcome =
  | { readonly kind: 'ok' }
  | { readonly kind: 'retry'; readonly effect: Effect; readonly error: CommandError };

/**
 * The durable reactor / process manager (D8): the one component that fires real effects, so it
 * must survive crashes without double-firing. It resumes from a durable checkpoint (at-least-once
 * delivery) and advances the checkpoint only after an event's effect is dispatched — so a restart
 * mid-download never re-dispatches an already-fired effect. A retryable effect failure parks its
 * OWN stream (durable entry + exponential backoff) while the checkpoint advances past it, so one
 * poisoned acquisition never stalls the rest (reactor-durability D1); the retry scheduler runs on
 * the same drain mutex, and a spent budget lands somewhere modeled (D2). Operational logs are
 * correlated by `acquisitionId` (D15); the pure `react`/`decide`/`evolve` stay log-free.
 */
export const REACTOR_CONSUMER = 'acquisition-reactor';

export interface ReactorDeps {
  readonly store: EventStorePort;
  readonly checkpoints: CheckpointStore;
  readonly bus: EventBus;
  readonly parked: ParkedEffectStore;
  readonly deadLetters: DeadLetterStore;
  /** The queryable face of dead-lettered effects (D4); the reactor marks and clears it. */
  readonly stalled: StalledReadModel;
  readonly logger: Logger;
  readonly interpreter: InterpreterDeps;
  /** Injectable fallback timer (defaults to `setInterval`); returns a stop function. */
  readonly interval?: (fn: () => void, ms: number) => () => void;
  readonly pollIntervalMs?: number;
  readonly retryPolicy?: RetryPolicy;
  /** Jitter roll ∈ [0, 1] (defaults to `Math.random`) — injectable for deterministic tests. */
  readonly random?: () => number;
}

const DEFAULT_POLL_INTERVAL_MS = 5_000;

const defaultInterval = (fn: () => void, ms: number): (() => void) => {
  const handle = setInterval(fn, ms);
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

  constructor(private readonly deps: ReactorDeps) {}

  private get policy(): RetryPolicy {
    return this.deps.retryPolicy ?? DEFAULT_RETRY_POLICY;
  }

  private now(): Date {
    return this.deps.interpreter.clock.now();
  }

  private roll(): number {
    return (this.deps.random ?? Math.random)();
  }

  /**
   * Resume from the checkpoint and drain to the head, following live wakeups plus a fallback
   * poll. The bus subscription attaches BEFORE the initial drain: an effect fired from the
   * backlog appends (and publishes) its own follow-on events mid-drain, and a one-shot
   * snapshot-then-subscribe would drop them into the gap between the snapshot and the
   * subscription — a crash-resumed chain would stall forever (found by the out-of-process
   * restart e2e). Wakeups are a lossy latency hint; the fallback poll is the delivery guarantee.
   */
  async start(): Promise<void> {
    const checkpoint = await this.deps.checkpoints.load(REACTOR_CONSUMER);
    this.lastProcessed = checkpoint.unwrapOr(0);

    this.unsubscribe = this.deps.bus.subscribe(() => {
      void this.drain();
    });
    this.stopInterval = (this.deps.interval ?? defaultInterval)(() => {
      void this.drain();
    }, this.deps.pollIntervalMs ?? DEFAULT_POLL_INTERVAL_MS);

    await this.drain();
  }

  stop(): void {
    this.unsubscribe?.();
    this.unsubscribe = undefined;
    this.stopInterval?.();
    this.stopInterval = undefined;
  }

  /**
   * Serialized pass over due retries then the catch-up backlog: concurrent wakeups coalesce into
   * one more pass. Everything that dispatches effects runs under this one mutex, so a retry and a
   * live drain can never race on the same acquisition.
   */
  async drain(): Promise<void> {
    if (this.running) {
      this.pending = true;
      return;
    }
    this.running = true;
    try {
      do {
        this.pending = false;
        await this.retryDueParked();
        const backlog = await this.deps.store.readAll(this.lastProcessed);
        if (backlog.isErr()) {
          this.deps.logger.error({ err: backlog.error }, 'reactor catch-up failed');
          return;
        }
        for (const stored of backlog.value) {
          await this.process(stored);
          if (this.lastProcessed < stored.globalSeq) {
            // The event could not be processed or parked durably (a store fault): stop here and
            // let the next wakeup or fallback poll retry, instead of hot-looping over it.
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

    const park = await this.deps.parked.find(stored.streamId);
    if (park.isErr()) {
      this.deps.logger.error(
        { acquisitionId: stored.streamId, err: park.error },
        'reactor park lookup failed',
      );
      return;
    }
    if (park.value !== undefined) {
      // The stream is parked: this later event queues behind the parked effect (no-leapfrog, D1).
      // The checkpoint advances — the event stays reachable through the stream for catch-up.
      this.deps.logger.debug(
        { acquisitionId: stored.streamId, globalSeq: stored.globalSeq },
        'stream parked; event queued behind the parked effect',
      );
      await this.advanceTo(stored.globalSeq);
      return;
    }

    const stream = await this.deps.store.readStream(stored.streamId);
    if (stream.isErr()) {
      this.deps.logger.error(
        { acquisitionId: stored.streamId, err: stream.error },
        'reactor stream read failed',
      );
      return;
    }

    // Read before dispatch: a landing inside the dispatch may mark the stream stalled, and that
    // fresh exposure must survive this very event — only a PREVIOUSLY stalled stream that now
    // drives successfully is resolved.
    const wasStalled = this.deps.stalled.isStalled(stored.streamId);
    const outcome = await this.dispatchEvent(stored, stream.value);
    if (outcome.kind === 'retry') {
      const parkedOk = await this.parkStream(stored, outcome.effect, outcome.error);
      if (!parkedOk) return; // fall back to holding the checkpoint — the poll retries in-line
    } else if (wasStalled) {
      // A stalled acquisition's stream was driven successfully again (a cancellation, an operator
      // resubmission): its dead letters are resolved — clear them and the stalled exposure.
      await this.clearStalled(stored.streamId);
    }
    await this.advanceTo(stored.globalSeq);
  }

  /**
   * Dispatch the effects of `stored` against the fold of the stream prefix up to and including it
   * (D1): a co-emitted or redelivered event sees its own post-state, never a later one. Permanent
   * faults land inside (degrade or dead-letter); a domain rejection is stale — recorded and
   * advanced past (D5); only a retryable failure is surfaced to the caller to park.
   */
  private async dispatchEvent(
    stored: StoredEvent,
    stream: readonly StoredEvent[],
  ): Promise<DispatchOutcome> {
    const prefix = stream.filter((entry) => entry.version <= stored.version);
    const acquisition = Acquisition.fromHistory(prefix.map((entry) => entry.event));
    for (const effect of acquisition.reactTo(stored.event)) {
      const result = await interpretEffect(this.deps.interpreter, stored.streamId, effect);
      if (result.isErr()) {
        if (isPermanentFault(result.error)) {
          const landed = await this.land(stored, effect, result.error, 1);
          if (!landed) return { kind: 'retry', effect, error: result.error };
          break;
        }
        if (isRetryable(result.error)) {
          return { kind: 'retry', effect, error: result.error };
        }
        // Stale/illegal outcome — the stream has already settled it. Record and advance past it
        // (D5); retrying would only re-fire the same rejection forever.
        this.deps.logger.warn(
          { acquisitionId: stored.streamId, effect: effect.type, err: result.error },
          'effect follow-on rejected as stale; advancing past it',
        );
        break;
      }
      this.deps.logger.debug(
        { acquisitionId: stored.streamId, effect: effect.type },
        'effect dispatched',
      );
    }
    return { kind: 'ok' };
  }

  /** Durably park the stream at `stored` for a backed-off retry. False if the park write failed. */
  private async parkStream(
    stored: StoredEvent,
    effect: Effect,
    error: CommandError,
  ): Promise<boolean> {
    const now = this.now();
    const schedule = nextRetry(this.policy, 1, now, now, this.roll());
    if (schedule.kind === 'exhausted') {
      // A zero-width budget: land straight away rather than schedule an impossible retry.
      return this.land(stored, effect, error, 1);
    }
    const entry: ParkedEffect = {
      streamId: stored.streamId,
      globalSeq: stored.globalSeq,
      attempt: 1,
      parkedAt: now.toISOString(),
      nextRetryAt: schedule.nextRetryAt.toISOString(),
      lastError: describeError(error),
    };
    const written = await this.deps.parked.park(entry);
    if (written.isErr()) {
      this.deps.logger.error(
        { acquisitionId: stored.streamId, effect: effect.type, err: written.error },
        'failed to park effect; holding the checkpoint',
      );
      return false;
    }
    this.deps.logger.warn(
      {
        acquisitionId: stored.streamId,
        effect: effect.type,
        attempt: 1,
        nextRetryAt: entry.nextRetryAt,
        err: error,
      },
      'effect parked for retry',
    );
    return true;
  }

  /** The retry scheduler (D2): re-dispatch every due parked effect, then resume its stream. */
  private async retryDueParked(): Promise<void> {
    const due = await this.deps.parked.due(this.now().toISOString());
    if (due.isErr()) {
      this.deps.logger.error({ err: due.error }, 'parked-effect due listing failed');
      return;
    }
    for (const entry of due.value) {
      await this.retryParked(entry);
    }
  }

  private async retryParked(entry: ParkedEffect): Promise<void> {
    const stream = await this.deps.store.readStream(entry.streamId);
    if (stream.isErr()) {
      this.deps.logger.error(
        { acquisitionId: entry.streamId, err: stream.error },
        'parked-effect retry could not read the stream',
      );
      return; // the entry stays due; a later tick retries
    }
    const stored = stream.value.find((event) => event.globalSeq === entry.globalSeq);
    if (stored === undefined) {
      // The parked position no longer exists (external log surgery): the park is meaningless.
      // Clear it; the startup re-drive derives pending work from state, not from this entry.
      this.deps.logger.error(
        { acquisitionId: entry.streamId, globalSeq: entry.globalSeq },
        'parked event missing from its stream; clearing the park',
      );
      await this.deps.parked.clear(entry.streamId);
      return;
    }

    const outcome = await this.dispatchEvent(stored, stream.value);
    if (outcome.kind === 'ok') {
      this.deps.logger.info(
        { acquisitionId: entry.streamId, attempt: entry.attempt },
        'parked effect resolved; resuming the stream',
      );
      await this.resumeStream(entry, stream.value);
      return;
    }

    // A permanent fault only reaches here when its inline landing failed on infrastructure
    // (dispatchEvent lands permanents itself): backing off before re-attempting the landing is
    // exactly right, so permanents need no special case in the schedule.
    const attempt = entry.attempt + 1;
    const now = this.now();
    const schedule = nextRetry(this.policy, attempt, new Date(entry.parkedAt), now, this.roll());
    if (schedule.kind === 'exhausted') {
      const landed = await this.land(stored, outcome.effect, outcome.error, attempt);
      if (landed) await this.resumeStream(entry, stream.value);
      return;
    }
    const rescheduled = await this.deps.parked.park({
      ...entry,
      attempt,
      nextRetryAt: schedule.nextRetryAt.toISOString(),
      lastError: describeError(outcome.error),
    });
    if (rescheduled.isErr()) {
      this.deps.logger.error(
        { acquisitionId: entry.streamId, err: rescheduled.error },
        'failed to reschedule parked effect',
      );
      return;
    }
    this.deps.logger.warn(
      {
        acquisitionId: entry.streamId,
        effect: outcome.effect.type,
        attempt,
        nextRetryAt: schedule.nextRetryAt.toISOString(),
        err: outcome.error,
      },
      'parked effect retry failed; rescheduled',
    );
  }

  /**
   * After a park resolves, dispatch the stream's queued events — those the drain advanced past
   * while parked — in order. A queued event that fails retryably parks the stream afresh (its own
   * budget); otherwise the park is cleared and the stream flows normally again.
   */
  private async resumeStream(entry: ParkedEffect, stream: readonly StoredEvent[]): Promise<void> {
    const queued = stream.filter(
      (event) => event.globalSeq > entry.globalSeq && event.globalSeq <= this.lastProcessed,
    );
    for (const stored of queued) {
      const outcome = await this.dispatchEvent(stored, stream);
      if (outcome.kind === 'retry') {
        // The fresh park replaces the resolved entry (upsert by stream) — nothing to clear.
        await this.parkStream(stored, outcome.effect, outcome.error);
        return;
      }
    }
    await this.deps.parked.clear(entry.streamId);
  }

  /**
   * Land a permanently failed or budget-exhausted effect (D2): degrade to its modeled business
   * failure through the normal command path where one exists; dead-letter with full context — and
   * expose the acquisition as stalled — where none does. Returns false when the landing itself
   * failed on infrastructure (the caller keeps the park so the landing is never lost).
   */
  private async land(
    stored: StoredEvent,
    effect: Effect,
    error: CommandError,
    attempt: number,
  ): Promise<boolean> {
    const command = degradeCommand(effect);
    if (command !== undefined) {
      const applied = await applyCommand(this.deps.interpreter, stored.streamId, command);
      if (applied.isOk()) {
        this.deps.logger.error(
          { acquisitionId: stored.streamId, effect: effect.type, attempt, err: error },
          'retry budget exhausted; degrading to modeled failure',
        );
        return true;
      }
      if (isRetryable(applied.error) || isPermanentFault(applied.error)) {
        this.deps.logger.error(
          { acquisitionId: stored.streamId, effect: effect.type, err: applied.error },
          'degrade command failed; will land again',
        );
        return false;
      }
      // The domain rejected the degrade: the stream has already settled past it — landed.
      this.deps.logger.warn(
        { acquisitionId: stored.streamId, effect: effect.type, err: applied.error },
        'degrade rejected as stale; stream already settled',
      );
      return true;
    }

    const recorded = await this.deps.deadLetters.record({
      subscription: REACTOR_CONSUMER,
      globalSeq: stored.globalSeq,
      streamId: stored.streamId,
      error: JSON.stringify({
        effect: effect.type,
        attempt,
        error: describeError(error),
      }),
      occurredAt: this.now().toISOString(),
    });
    if (recorded.isErr()) {
      this.deps.logger.error(
        { acquisitionId: stored.streamId, effect: effect.type, err: recorded.error },
        'dead-letter write failed; will land again',
      );
      return false;
    }
    this.deps.stalled.mark(stored.streamId);
    this.deps.logger.error(
      { acquisitionId: stored.streamId, effect: effect.type, attempt, err: error },
      'retry budget exhausted; effect dead-lettered and acquisition stalled',
    );
    return true;
  }

  /** Resolution clears retention (D2): the stream's letters and its stalled exposure go together. */
  private async clearStalled(streamId: string): Promise<void> {
    const cleared = await this.deps.deadLetters.clearStream(REACTOR_CONSUMER, streamId);
    if (cleared.isErr()) {
      // Stay marked stalled — the letters still exist; a later successful event retries the clear.
      this.deps.logger.error(
        { acquisitionId: streamId, err: cleared.error },
        'failed to clear resolved dead letters',
      );
      return;
    }
    this.deps.stalled.clear(streamId);
    this.deps.logger.info({ acquisitionId: streamId }, 'stalled acquisition resumed');
  }

  private async advanceTo(globalSeq: number): Promise<void> {
    this.lastProcessed = globalSeq;
    await this.deps.checkpoints.save(REACTOR_CONSUMER, globalSeq);
  }
}
