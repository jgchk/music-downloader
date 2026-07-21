import { Import } from '../../domain/import/import.js';
import type { Logger } from '../logging/logger.js';
import type {
  CheckpointStore,
  EventBus,
  EventStorePort,
  StoredEvent,
} from '../ports/event-store-port.js';
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

/**
 * The durable reactor / process manager: the one component that fires real effects, so it must
 * survive crashes without double-firing. It resumes from a durable checkpoint (at-least-once
 * delivery) and advances the checkpoint only after an event's effect is dispatched — so a restart
 * mid-import never re-dispatches an already-fired effect. Operational logs are correlated by
 * `importId`; the pure `react`/`decide`/`evolve` stay log-free.
 */
export const REACTOR_CONSUMER = 'import-reactor';

/** How the reactor fires one effect — the composition root closes this over the interpreter. */
export type EffectInterpreter = (
  importId: string,
  effect: Effect,
) => ResultAsync<readonly StoredEvent[], CommandError>;

export interface ReactorDeps {
  readonly store: EventStorePort;
  readonly checkpoints: CheckpointStore;
  readonly bus: EventBus;
  readonly logger: Logger;
  readonly interpret: EffectInterpreter;
  /** Injectable fallback timer (defaults to `setInterval`); returns a stop function. */
  readonly interval?: (fn: () => void, ms: number) => () => void;
  readonly pollIntervalMs?: number;
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

  /**
   * Resume from the checkpoint and drain to the head, following live wakeups plus a fallback
   * poll. The bus subscription attaches BEFORE the initial drain: an effect fired from the
   * backlog appends its own follow-on events mid-drain, and a one-shot snapshot-then-subscribe
   * would drop them into the gap between the snapshot and the subscription (a crash-resumed
   * import would stall forever — found by the out-of-process restart e2e). Wakeups are a lossy
   * latency hint; the fallback poll is the delivery guarantee.
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
        const backlog = await this.deps.store.readAll(this.lastProcessed);
        if (backlog.isErr()) {
          this.deps.logger.error({ err: backlog.error }, 'reactor catch-up failed');
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

    const stream = await this.deps.store.readStream(stored.streamId);
    if (stream.isErr()) {
      this.deps.logger.error(
        { importId: stored.streamId, err: stream.error },
        'reactor stream read failed',
      );
      return;
    }

    // React against the state as of `stored` — the fold of the stream prefix up to and including it
    // — not the whole stream. This keeps `react` a deterministic function of the prefix: a
    // co-emitted or redelivered event sees its own post-state, never a later one.
    const prefix = stream.value.filter((entry) => entry.version <= stored.version);
    const aggregate = Import.fromHistory(prefix.map((entry) => entry.event));
    for (const effect of aggregate.reactTo(stored.event)) {
      const result = await this.deps.interpret(stored.streamId, effect);
      if (result.isErr()) {
        if (isRetryable(result.error)) {
          // Transient fault: leave the checkpoint unadvanced so the effect is retried.
          this.deps.logger.error(
            { importId: stored.streamId, effect: effect.type, err: result.error },
            'effect dispatch failed',
          );
          return;
        }
        // Stale/illegal outcome — the stream has already settled it. Record and advance past
        // it; retrying would only re-fire the same rejection forever.
        this.deps.logger.warn(
          { importId: stored.streamId, effect: effect.type, err: result.error },
          'effect follow-on rejected as stale; advancing past it',
        );
        break;
      }
      this.deps.logger.debug(
        { importId: stored.streamId, effect: effect.type },
        'effect dispatched',
      );
    }

    this.lastProcessed = stored.globalSeq;
    await this.deps.checkpoints.save(REACTOR_CONSUMER, stored.globalSeq);
  }
}
