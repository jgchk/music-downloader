import { errAsync, okAsync } from 'neverthrow';
import type { ResultAsync } from 'neverthrow';
import { Acquisition } from '../../domain/acquisition/acquisition.js';
import type { DomainError } from '../../domain/acquisition/acquisition.js';
import type { AcquisitionCommand } from '../../domain/acquisition/commands.js';
import type { CommandContext } from '../correlation/context.js';
import type {
  AppendError,
  AppendMetadata,
  EventStorePort,
  StoredEvent,
} from '../ports/event-store-port.js';
import type { Clock } from '../ports/system-ports.js';

/**
 * The single write path (D2): load the stream, fold it, run `decide`, and append the resulting
 * events under optimistic concurrency. `decide` is the guard — stale/duplicate outcomes come back
 * as an empty event list (no append), protocol violations as a `DomainError`.
 *
 * A lost optimistic-concurrency race re-runs the command against the fresh stream (bounded): with
 * asynchronous download outcomes (nonblocking-download-observation D2), a reactor follow-on and
 * the outcome consumer lawfully append concurrently, and the benign loser must re-decide — where
 * the stale guards absorb it — rather than surface a retryable fault that parks its stream for
 * nothing. Persistent contention still surfaces as the conflict.
 */
export type CommandError = DomainError | AppendError;

export interface CommandDependencies {
  readonly store: EventStorePort;
  readonly clock: Clock;
}

const OPTIMISTIC_ATTEMPTS = 3;

export function applyCommand(
  dependencies: CommandDependencies,
  acquisitionId: string,
  command: AcquisitionCommand,
  context: CommandContext,
): ResultAsync<readonly StoredEvent[], CommandError> {
  return attemptCommand(dependencies, acquisitionId, command, context, OPTIMISTIC_ATTEMPTS);
}

function attemptCommand(
  dependencies: CommandDependencies,
  acquisitionId: string,
  command: AcquisitionCommand,
  context: CommandContext,
  attemptsLeft: number,
): ResultAsync<readonly StoredEvent[], CommandError> {
  return dependencies.store.readStream(acquisitionId).andThen((stored) => {
    const acquisition = Acquisition.fromHistory(stored.map((entry) => entry.event));
    const decision = acquisition.execute(command);
    if (decision.isErr()) return errAsync(decision.error);
    if (decision.value.length === 0) return okAsync<readonly StoredEvent[], CommandError>([]);
    // ONE metadata per decision, so every event of this batch shares ONE causation: the command
    // that decided them is their common parent. Chaining event-to-event inside a batch would
    // invent a causal order the decider never expressed.
    const metadata: AppendMetadata = {
      acquisitionId,
      occurredAt: dependencies.clock.now().toISOString(),
      correlationId: context.correlationId,
      causation: context.causation,
    };
    return dependencies.store
      .append(acquisitionId, stored.length, decision.value, metadata)
      .orElse((error) =>
        error.kind === 'ConcurrencyConflict' && attemptsLeft > 1
          ? // The re-decide is the SAME unit of work, so it keeps the same context: a lost race
            // must not fork the story into a second one.
            attemptCommand(dependencies, acquisitionId, command, context, attemptsLeft - 1)
          : errAsync<readonly StoredEvent[], CommandError>(error),
      );
  });
}
