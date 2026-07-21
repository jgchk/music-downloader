import { errAsync, okAsync } from 'neverthrow';
import type { ResultAsync } from 'neverthrow';
import { Acquisition } from '../../domain/acquisition/acquisition.js';
import type { DomainError } from '../../domain/acquisition/acquisition.js';
import type { AcquisitionCommand } from '../../domain/acquisition/commands.js';
import type {
  AppendError,
  EventMetadata,
  EventStorePort,
  StoredEvent,
} from '../ports/event-store-port.js';
import type { Clock } from '../ports/system-ports.js';

/**
 * The single write path (D2): load the stream, fold it, run `decide`, and append the resulting
 * events under optimistic concurrency. `decide` is the guard — stale/duplicate outcomes come back
 * as an empty event list (no append), protocol violations as a `DomainError`.
 */
export type CommandError = DomainError | AppendError;

export interface CommandDeps {
  readonly store: EventStorePort;
  readonly clock: Clock;
}

export function applyCommand(
  deps: CommandDeps,
  acquisitionId: string,
  command: AcquisitionCommand,
): ResultAsync<readonly StoredEvent[], CommandError> {
  return deps.store.readStream(acquisitionId).andThen((stored) => {
    const acquisition = Acquisition.fromHistory(stored.map((entry) => entry.event));
    const decision = acquisition.execute(command);
    if (decision.isErr()) return errAsync(decision.error);
    if (decision.value.length === 0) return okAsync<readonly StoredEvent[], CommandError>([]);
    const metadata: EventMetadata = {
      acquisitionId,
      occurredAt: deps.clock.now().toISOString(),
    };
    return deps.store.append(acquisitionId, stored.length, decision.value, metadata);
  });
}
