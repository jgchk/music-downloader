import type { Effect } from '../../domain/acquisition/acquisition.js';
import type { AcquisitionCommand } from '../../domain/acquisition/commands.js';
import type { Logger } from '../logging/logger.js';
import type { DeadLetterStore } from '../ports/dead-letter-port.js';
import type { StoredEvent } from '../ports/event-store-port.js';
import type { Clock } from '../ports/system-ports.js';
import type { StalledReadModel } from '../projections/read-models.js';
import { applyCommand } from './command-handler.js';
import type { CommandError } from './command-handler.js';
import type { InterpreterDependencies } from './interpreter.js';
import { classifyCommandError, describeCommandError } from './failure-classification.js';

/**
 * The landing policy for a permanently failed or budget-exhausted effect (reactor-durability D2):
 * what a spent budget degrades to, the dead-letter shape, and the stalled exposure. Separated
 * from the reactor's drain/scheduling machinery because these are its own reasons to change; the
 * reactor owns WHEN to land, this unit owns WHERE the failure comes to rest.
 */

/**
 * The modeled landing per effect kind: degrade to the effect's business failure through the
 * normal command path where one exists (D2); the enumeration is exhaustive with no default so a
 * new `Effect` variant forces an explicit decision here instead of silently dead-lettering.
 */
function degradeCommand(effect: Effect): AcquisitionCommand | undefined {
  switch (effect.type) {
    case 'ResolveMetadata': {
      return { type: 'RecordMetadataFailed' };
    }
    case 'Download': {
      // Hours without progress IS a stalled download; the rejection advances the candidate ladder.
      return { type: 'RecordDownloadFailed', reason: 'Stalled' };
    }
    case 'AbortDownload': {
      // The abort's settlement: reject the pending candidate as the interpreter would have.
      return { type: 'RecordDownloadFailed', reason: 'Cancelled' };
    }
    case 'Search':
    case 'Validate':
    case 'Import':
    case 'Cleanup': {
      // No modeled failure to degrade to — dead-letter and expose the acquisition as stalled.
      return undefined;
    }
  }
}

export interface EffectLanderDependencies {
  readonly interpreter: InterpreterDependencies;
  readonly deadLetters: DeadLetterStore;
  readonly stalled: StalledReadModel;
  readonly clock: Clock;
  readonly logger: Logger;
  /** The dead-letter subscription name — the reactor's consumer key. */
  readonly subscription: string;
}

export class EffectLander {
  constructor(private readonly dependencies: EffectLanderDependencies) {}

  /**
   * Land the failure (D2): degrade where modeled, dead-letter — and mark stalled — where not.
   * Returns false when the landing itself failed on infrastructure, so the caller keeps the park
   * and the landing is never lost.
   */
  async land(
    stored: StoredEvent,
    effect: Effect,
    error: CommandError,
    attempt: number,
  ): Promise<boolean> {
    const command = degradeCommand(effect);
    if (command !== undefined) {
      const applied = await applyCommand(this.dependencies.interpreter, stored.streamId, command);
      if (applied.isOk()) {
        this.dependencies.logger.error(
          { acquisitionId: stored.streamId, effect: effect.type, attempt, err: error },
          'effect landed; degrading to modeled failure',
        );
        return true;
      }
      if (classifyCommandError(applied.error) === 'rejection') {
        // The domain rejected the degrade: the stream has already settled past it — landed.
        this.dependencies.logger.warn(
          { acquisitionId: stored.streamId, effect: effect.type, err: applied.error },
          'degrade rejected as stale; stream already settled',
        );
        return true;
      }
      this.dependencies.logger.error(
        { acquisitionId: stored.streamId, effect: effect.type, err: applied.error },
        'degrade command failed; will land again',
      );
      return false;
    }

    const recorded = await this.dependencies.deadLetters.record({
      subscription: this.dependencies.subscription,
      globalSeq: stored.globalSeq,
      streamId: stored.streamId,
      error: JSON.stringify({
        effect: effect.type,
        attempt,
        error: describeCommandError(error),
      }),
      occurredAt: this.dependencies.clock.now().toISOString(),
    });
    if (recorded.isErr()) {
      this.dependencies.logger.error(
        { acquisitionId: stored.streamId, effect: effect.type, err: recorded.error },
        'dead-letter write failed; will land again',
      );
      return false;
    }
    this.dependencies.stalled.mark(stored.streamId);
    this.dependencies.logger.error(
      { acquisitionId: stored.streamId, effect: effect.type, attempt, err: error },
      'effect landed; dead-lettered and acquisition stalled',
    );
    return true;
  }

  /** Resolution clears retention (D2): the stream's letters and its stalled exposure go together. */
  async clearStalled(streamId: string): Promise<void> {
    const cleared = await this.dependencies.deadLetters.clearStream(
      this.dependencies.subscription,
      streamId,
    );
    if (cleared.isErr()) {
      // Stay marked stalled — the letters still exist; a later successful event retries the clear.
      this.dependencies.logger.error(
        { acquisitionId: streamId, err: cleared.error },
        'failed to clear resolved dead letters',
      );
      return;
    }
    this.dependencies.stalled.clear(streamId);
    this.dependencies.logger.info({ acquisitionId: streamId }, 'stalled acquisition resumed');
  }
}
