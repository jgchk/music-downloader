import { Acquisition } from '../../domain/acquisition/acquisition.js';
import type { Effect } from '../../domain/acquisition/acquisition.js';
import type { Logger } from '../logging/logger.js';
import type { DeadLetterStore } from '../ports/dead-letter-port.js';
import type {
  CheckpointStore,
  EventBus,
  EventStorePort,
  StoredEvent,
} from '../ports/event-store-port.js';
import type { ParkedEffect, ParkedEffectStore } from '../ports/parked-effect-port.js';
import type { Clock } from '../ports/system-ports.js';
import type { StalledReadModel } from '../projections/read-models.js';
import type { CommandError } from './command-handler.js';
import { EffectLander } from './effect-lander.js';
import { classifyCommandError, describeCommandError } from './failure-classification.js';
import { interpretEffect } from './interpreter.js';
import type { InterpreterDeps } from './interpreter.js';
import { DEFAULT_RETRY_POLICY, nextRetry } from './retry-policy.js';
import type { RetryPolicy } from './retry-policy.js';

type DispatchOutcome =
  | { readonly kind: 'ok' }
  | { readonly kind: 'retry'; readonly effect: Effect; readonly error: CommandError };

/**
 * The durable reactor / process manager (bootstrap D8): the one component that fires real
 * effects, so it must survive crashes without losing or wedging work. It resumes from a durable
 * checkpoint (at-least-once delivery) and advances the checkpoint only once an event's effect is
 * dispatched OR durably parked; after a restart, pending work is re-derived from folded state and
 * re-dispatched through the idempotent path (reactor-durability D3) — the download adapter
 * reconciles and re-attaches rather than downloading twice. A retryable effect failure parks its
 * OWN stream (durable entry + exponential backoff) while the checkpoint advances past it, so one
 * poisoned acquisition never stalls the rest (reactor-durability D1); the retry scheduler runs on
 * the same drain mutex, and a spent budget lands somewhere modeled via the {@link EffectLander}
 * (D2). Operational logs are correlated by `acquisitionId` (bootstrap D15); the pure
 * `react`/`decide`/`evolve` stay log-free.
 */
export const REACTOR_CONSUMER = 'acquisition-reactor';

export interface ReactorDeps {
  readonly store: EventStorePort;
  readonly checkpoints: CheckpointStore;
  readonly bus: EventBus;
  readonly parked: ParkedEffectStore;
  readonly deadLetters: DeadLetterStore;
  /** The queryable face of dead-lettered effects (reactor-durability D2/D5). */
  readonly stalled: StalledReadModel;
  readonly logger: Logger;
  readonly interpreter: InterpreterDeps;
  readonly clock: Clock;
  /** The fallback poll timer (composition supplies the real `setInterval`); returns a stopper. */
  readonly interval: (fn: () => void, ms: number) => () => void;
  /** Sleep for the re-drive pass's jitter (composition supplies the real timeout). */
  readonly sleep: (ms: number) => Promise<void>;
  /** Jitter roll ∈ [0, 1] (composition supplies `Math.random`). */
  readonly random: () => number;
  readonly pollIntervalMs?: number;
  readonly retryPolicy?: RetryPolicy;
  /** Upper bound of the jittered gap between re-driven streams (rate limit, D3). */
  readonly redriveGapMs?: number;
}

const DEFAULT_POLL_INTERVAL_MS = 5_000;
const DEFAULT_REDRIVE_GAP_MS = 1_000;

export class Reactor {
  private lastProcessed = 0;
  private unsubscribe: (() => void) | undefined;
  private stopInterval: (() => void) | undefined;
  private running = false;
  private pending = false;
  private stopped = false;
  /** The dispatch mutex: drain passes and the startup re-drive serialize through this chain. */
  private mutex: Promise<void> = Promise.resolve();
  private readonly lander: EffectLander;

  constructor(private readonly deps: ReactorDeps) {
    this.lander = new EffectLander({
      interpreter: deps.interpreter,
      deadLetters: deps.deadLetters,
      stalled: deps.stalled,
      clock: deps.clock,
      logger: deps.logger,
      subscription: REACTOR_CONSUMER,
    });
  }

  /**
   * Failures inside a pass are values (neverthrow) — an actual throw is a bug. It is caught and
   * logged here so one buggy pass can never poison the chain and silence the reactor for good.
   */
  private withMutex(work: () => Promise<void>): Promise<void> {
    const run = this.mutex.then(work).catch((err: unknown) => {
      this.deps.logger.error({ err }, 'reactor pass failed unexpectedly');
    });
    this.mutex = run;
    return run;
  }

  private get policy(): RetryPolicy {
    return this.deps.retryPolicy ?? DEFAULT_RETRY_POLICY;
  }

  private now(): Date {
    return this.deps.clock.now();
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
    if (this.stopped) return; // stopped while loading (a backgrounded boot torn down early)
    if (checkpoint.isErr()) {
      // Replaying from the log start is safe (idempotent effects + decide's stale guards) but
      // noisy and slow — the operator must be able to tell it apart from a fresh consumer.
      this.deps.logger.error(
        { err: checkpoint.error },
        'checkpoint load failed; replaying from the log start',
      );
    }
    this.lastProcessed = checkpoint.unwrapOr(0);

    this.unsubscribe = this.deps.bus.subscribe(() => {
      void this.drain();
    });
    this.stopInterval = this.deps.interval(() => {
      void this.drain();
    }, this.deps.pollIntervalMs ?? DEFAULT_POLL_INTERVAL_MS);

    await this.drain();
    await this.redrive();
  }

  stop(): void {
    this.stopped = true;
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
    return this.withMutex(async () => {
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
    });
  }

  /**
   * The startup re-drive pass (D3) — level-triggered reconciliation: after the catch-up drain,
   * fold every stream and re-dispatch the effect its current state is waiting on through the
   * normal idempotent path. Terminal streams derive none; awaiting-selection pauses derive none
   * (the pause is the state's meaning); parked streams belong to the retry scheduler and stalled
   * ones to the operator. The pass is jittered between streams so a boot with many pending
   * acquisitions does not stampede the upstreams, and it runs on the dispatch mutex so it can
   * never race a live drain over the same acquisition (a check-then-act re-attach hazard).
   */
  private redrive(): Promise<void> {
    return this.withMutex(async () => {
      const all = await this.deps.store.readAll(0);
      if (all.isErr()) {
        this.deps.logger.error({ err: all.error }, 'startup re-drive could not read the log');
        return;
      }
      const streams = new Map<string, StoredEvent[]>();
      for (const stored of all.value) {
        const list = streams.get(stored.streamId) ?? [];
        list.push(stored);
        streams.set(stored.streamId, list);
      }
      for (const [streamId, events] of streams) {
        if (this.stopped) return;
        await this.redriveStream(streamId, events);
      }
    });
  }

  private async redriveStream(streamId: string, events: readonly StoredEvent[]): Promise<void> {
    if (this.deps.stalled.isStalled(streamId)) return; // landed; awaiting an operator
    const park = await this.deps.parked.find(streamId);
    if (park.isErr()) {
      // The stream may be mid-retry; re-driving blind could double-dispatch, so skip this boot —
      // but say so: an unlogged skip here is the "pending forever, nothing in the logs" class.
      this.deps.logger.error(
        { acquisitionId: streamId, err: park.error },
        'startup re-drive park lookup failed; stream skipped this boot',
      );
      return;
    }
    if (park.value !== undefined) return; // the retry scheduler owns it
    const acquisition = Acquisition.fromHistory(events.map((entry) => entry.event));
    if (acquisition.isTerminal) return;
    const last = events[events.length - 1]!;
    if (acquisition.reactTo(last.event).length === 0) return; // nothing pending (e.g. paused)

    const gap = this.deps.redriveGapMs ?? DEFAULT_REDRIVE_GAP_MS;
    await this.deps.sleep(gap * this.deps.random());
    this.deps.logger.info(
      { acquisitionId: streamId, phase: acquisition.phase },
      'startup re-drive dispatching the pending effect',
    );
    const outcome = await this.dispatchEvent(last, events);
    if (outcome.kind === 'retry') {
      const parkedOk = await this.parkStream(last, outcome.effect, outcome.error);
      if (!parkedOk) {
        // No checkpoint to hold here: an unparked re-drive failure waits for the next restart.
        this.deps.logger.error(
          { acquisitionId: streamId },
          're-driven effect failed and could not be parked; deferred to the next restart',
        );
      }
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
      await this.lander.clearStalled(stored.streamId);
    }
    await this.advanceTo(stored.globalSeq);
  }

  /**
   * Dispatch the effects of `stored` against the fold of the stream prefix up to and including it
   * (D1): a co-emitted or redelivered event sees its own post-state, never a later one. Permanent
   * faults land inside (degrade or dead-letter); a domain rejection is stale — recorded and
   * advanced past, per decide's stale-outcome contract. The caller is handed a `retry` for a
   * retryable failure — or for a permanent fault whose landing itself failed on infrastructure,
   * so the park backs off before the landing is re-attempted.
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
        switch (classifyCommandError(result.error)) {
          case 'permanent': {
            const landed = await this.lander.land(stored, effect, result.error, 1);
            if (!landed) return { kind: 'retry', effect, error: result.error };
            break;
          }
          case 'retryable':
            return { kind: 'retry', effect, error: result.error };
          case 'rejection':
            // Stale/illegal outcome — the stream has already settled it. Record and advance past
            // it; retrying would only re-fire the same rejection forever.
            this.deps.logger.warn(
              { acquisitionId: stored.streamId, effect: effect.type, err: result.error },
              'effect follow-on rejected as stale; advancing past it',
            );
            break;
        }
        break;
      }
      this.deps.logger.debug(
        { acquisitionId: stored.streamId, effect: effect.type },
        'effect dispatched',
      );
    }
    return { kind: 'ok' };
  }

  /**
   * Durably park the stream at `stored` for a backed-off retry — or, on a zero-width budget,
   * land straight away. False only when the durable write (or landing) failed, so the caller
   * holds the checkpoint instead.
   */
  private async parkStream(
    stored: StoredEvent,
    effect: Effect,
    error: CommandError,
  ): Promise<boolean> {
    const now = this.now();
    const schedule = nextRetry(this.policy, 1, now, now, this.deps.random());
    if (schedule.kind === 'exhausted') {
      return this.lander.land(stored, effect, error, 1);
    }
    const entry: ParkedEffect = {
      streamId: stored.streamId,
      globalSeq: stored.globalSeq,
      attempt: 1,
      parkedAt: now.toISOString(),
      nextRetryAt: schedule.nextRetryAt.toISOString(),
      lastError: describeCommandError(error),
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
      await this.clearPark(entry.streamId);
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
    const schedule = nextRetry(
      this.policy,
      attempt,
      new Date(entry.parkedAt),
      now,
      this.deps.random(),
    );
    if (schedule.kind === 'exhausted') {
      const landed = await this.lander.land(stored, outcome.effect, outcome.error, attempt);
      if (landed) await this.resumeStream(entry, stream.value);
      return;
    }
    const rescheduled = await this.deps.parked.park({
      ...entry,
      attempt,
      nextRetryAt: schedule.nextRetryAt.toISOString(),
      lastError: describeCommandError(outcome.error),
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
    await this.clearPark(entry.streamId);
  }

  /** Clear a park, loudly: a lingering past-due entry re-fires its effect on every tick. */
  private async clearPark(streamId: string): Promise<void> {
    const cleared = await this.deps.parked.clear(streamId);
    if (cleared.isErr()) {
      this.deps.logger.error(
        { acquisitionId: streamId, err: cleared.error },
        'failed to clear the resolved park; its effect will re-fire each tick until cleared',
      );
    }
  }

  private async advanceTo(globalSeq: number): Promise<void> {
    this.lastProcessed = globalSeq;
    const saved = await this.deps.checkpoints.save(REACTOR_CONSUMER, globalSeq);
    if (saved.isErr()) {
      // The in-memory cursor advances regardless: at-least-once tolerates the redelivery a stale
      // durable checkpoint causes after a restart, but the operator must see it happening.
      this.deps.logger.error({ globalSeq, err: saved.error }, 'checkpoint save failed');
    }
  }
}
