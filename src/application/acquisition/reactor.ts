import { Acquisition } from '../../domain/acquisition/acquisition.js';
import type { Logger } from '../logging/logger.js';
import type {
  CheckpointStore,
  EventBus,
  EventStorePort,
  StoredEvent,
} from '../ports/event-store-port.js';
import { interpretEffect } from './interpreter.js';
import type { InterpreterDeps } from './interpreter.js';

/**
 * The durable reactor / process manager (D8): the one component that fires real effects, so it
 * must survive crashes without double-firing. It resumes from a durable checkpoint (at-least-once
 * delivery) and advances the checkpoint only after an event's effect is dispatched — so a restart
 * mid-download never re-dispatches an already-fired effect. Operational logs are correlated by
 * `acquisitionId` (D15); the pure `react`/`decide`/`evolve` stay log-free.
 */
export const REACTOR_CONSUMER = 'acquisition-reactor';

export interface ReactorDeps {
  readonly store: EventStorePort;
  readonly checkpoints: CheckpointStore;
  readonly bus: EventBus;
  readonly logger: Logger;
  readonly interpreter: InterpreterDeps;
}

export class Reactor {
  private lastProcessed = 0;
  private unsubscribe: (() => void) | undefined;

  constructor(private readonly deps: ReactorDeps) {}

  /** Resume from the checkpoint, drain the backlog, then follow live events off the bus. */
  async start(): Promise<void> {
    const checkpoint = await this.deps.checkpoints.load(REACTOR_CONSUMER);
    this.lastProcessed = checkpoint.unwrapOr(0);

    const backlog = await this.deps.store.readAll(this.lastProcessed);
    if (backlog.isErr()) {
      this.deps.logger.error({ err: backlog.error }, 'reactor catch-up failed');
    } else {
      for (const stored of backlog.value) {
        await this.process(stored);
      }
    }

    this.unsubscribe = this.deps.bus.subscribe((stored) => {
      void this.process(stored);
    });
  }

  stop(): void {
    this.unsubscribe?.();
  }

  async process(stored: StoredEvent): Promise<void> {
    if (stored.globalSeq <= this.lastProcessed) return; // already handled (at-least-once dedupe)

    const stream = await this.deps.store.readStream(stored.streamId);
    if (stream.isErr()) {
      this.deps.logger.error(
        { acquisitionId: stored.streamId, err: stream.error },
        'reactor stream read failed',
      );
      return;
    }

    const acquisition = Acquisition.fromHistory(stream.value.map((entry) => entry.event));
    for (const effect of acquisition.reactTo(stored.event)) {
      const result = await interpretEffect(this.deps.interpreter, stored.streamId, effect);
      if (result.isErr()) {
        // Leave the checkpoint unadvanced so the effect is retried; do not swallow the fault.
        this.deps.logger.error(
          { acquisitionId: stored.streamId, effect: effect.type, err: result.error },
          'effect dispatch failed',
        );
        return;
      }
      this.deps.logger.debug(
        { acquisitionId: stored.streamId, effect: effect.type },
        'effect dispatched',
      );
    }

    this.lastProcessed = stored.globalSeq;
    await this.deps.checkpoints.save(REACTOR_CONSUMER, stored.globalSeq);
  }
}
