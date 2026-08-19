import type { Effect } from '../../domain/download/download.js';
import type { DownloadCommand } from '../../domain/download/commands.js';
import type { Logger } from '../logging/logger.js';
import type { OperationScope } from '../correlation/context.js';
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
function degradeCommand(effect: Effect): DownloadCommand | undefined {
  switch (effect.type) {
    case 'ResolveMetadata': {
      return { type: 'RecordMetadataFailed' };
    }
    case 'Download': {
      // A spent budget here means the short ensure-start itself kept faulting (the source's
      // enqueue/start API down for the whole retry window) — the transfer may never have begun.
      // 'Stalled' is the closest modeled reason and advances the candidate ladder; genuine
      // transfer stalls are the supervisor's watch's to detect and arrive through the outcome
      // consumer, never through this landing. The candidate is named so a landing that fires
      // after the ladder has already moved on is absorbed as stale, not mis-attached.
      return {
        type: 'RecordTryFailed',
        reason: 'Stalled',
        candidate: effect.candidate.identity,
      };
    }
    case 'AbortDownload': {
      // The abort's settlement: reject the pending candidate as the interpreter would have.
      return {
        type: 'RecordTryFailed',
        // Stryker disable next-line StringLiteral: equivalent — an unread argument. This effect is
        // emitted only by the `DownloadCancelled` reaction, so the stream is in the terminal
        // `Cancelled` phase whenever the degrade lands (redelivery included), and that arm of
        // `decide` settles the pending candidate with a `CandidateRejected` alone — no
        // `TryFailed` carrying a reason is ever emitted. The field is required by the command
        // type, so it cannot be dropped; it is stated truthfully rather than left blank. The
        // `Download` arm above is the opposite case: there the reason IS recorded, and pinned.
        reason: 'Cancelled',
        candidate: effect.candidate.identity,
      };
    }
    // The no-modeled-failure arm. Every mutant these four labels carry still yields `undefined`:
    // there is no `default`, so an effect whose label was emptied matches nothing and falls out of
    // the switch to the function's implicit tail return — the same `undefined` the shared body
    // returns — and emptying the body returns `undefined` the same way. Callers branch on
    // `command !== undefined` alone, so none can tell any of them apart. The labels are the
    // compile-time exhaustiveness pin described above, not a runtime branch.
    //
    // Waived per label rather than with a block `disable` / `restore all` pair. A `restore` written
    // as the last comment inside a block is not a LEADING comment of any node, and Stryker's
    // directive bookkeeper reads leading comments only — so the block form never ended, and these
    // three mutators were silenced for the whole rest of the file, `land()` included.
    // Stryker disable next-line StringLiteral: an emptied label still yields undefined
    case 'Search':
    // Stryker disable next-line StringLiteral: an emptied label still yields undefined
    case 'Validate':
    // Stryker disable next-line StringLiteral: an emptied label still yields undefined
    case 'Import':
    // Stryker disable next-line StringLiteral,ConditionalExpression,BlockStatement: still undefined
    case 'Cleanup': {
      // No modeled failure to degrade to — dead-letter and expose the download as stalled.
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
    scope: OperationScope,
  ): Promise<boolean> {
    const command = degradeCommand(effect);
    if (command !== undefined) {
      // The degrade belongs to the dispatch that failed, so it continues that dispatch's story.
      const applied = await applyCommand(
        this.dependencies.interpreter,
        stored.streamId,
        command,
        scope.context,
      );
      if (applied.isOk()) {
        scope.logger.error(
          { acquisitionId: stored.streamId, effect: effect.type, attempt, err: error },
          'effect landed; degrading to modeled failure',
        );
        return true;
      }
      if (classifyCommandError(applied.error) === 'rejection') {
        // The domain rejected the degrade: the stream has already settled past it — landed.
        scope.logger.warn(
          { acquisitionId: stored.streamId, effect: effect.type, err: applied.error },
          'degrade rejected as stale; stream already settled',
        );
        return true;
      }
      scope.logger.error(
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
      scope.logger.error(
        { acquisitionId: stored.streamId, effect: effect.type, err: recorded.error },
        'dead-letter write failed; will land again',
      );
      return false;
    }
    this.dependencies.stalled.mark(stored.streamId);
    scope.logger.error(
      { acquisitionId: stored.streamId, effect: effect.type, attempt, err: error },
      'effect landed; dead-lettered and download stalled',
    );
    return true;
  }

  /** Resolution clears retention (D2): the stream's letters and its stalled exposure go together. */
  async clearStalled(streamId: string, scope: OperationScope): Promise<void> {
    const cleared = await this.dependencies.deadLetters.clearStream(
      this.dependencies.subscription,
      streamId,
    );
    if (cleared.isErr()) {
      // Stay marked stalled — the letters still exist; a later successful event retries the clear.
      scope.logger.error(
        { acquisitionId: streamId, err: cleared.error },
        'failed to clear resolved dead letters',
      );
      return;
    }
    this.dependencies.stalled.clear(streamId);
    scope.logger.info({ acquisitionId: streamId }, 'stalled download resumed');
  }
}
