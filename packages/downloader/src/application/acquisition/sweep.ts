import { Acquisition } from '../../domain/acquisition/acquisition.js';
import type { Logger } from '../logging/logger.js';
import type { InfraError } from '../ports/errors.js';
import type { EventStorePort } from '../ports/event-store-port.js';
import type {
  ResourceLedgerStore,
  SourceResource,
  SourceResourceRemover,
} from '../ports/resource-ledger-port.js';
import type { ResultAsync } from 'neverthrow';

/**
 * The startup sweep (D: source-resource stewardship): the app finishes removals it still owes the
 * source. For every live ledger row whose owning acquisition has reached a terminal state, it removes
 * the resource from the source and marks the row removed. Rows owned by an in-flight acquisition are
 * left untouched — the reactor still owns them — and a resource with no ledger row is, by
 * construction, invisible here, so a shared source's other tenants are never touched. Per-row fault
 * isolation keeps one failure from stalling the rest; unconverged rows are retried on the next boot.
 */
export interface SweepDeps {
  readonly ledger: ResourceLedgerStore;
  readonly remover: SourceResourceRemover;
  readonly store: EventStorePort;
  readonly logger: Logger;
}

export class SourceResourceSweep {
  constructor(private readonly deps: SweepDeps) {}

  async run(): Promise<void> {
    const live = await this.deps.ledger.allLive();
    if (live.isErr()) {
      this.deps.logger.error({ err: live.error }, 'sweep: cannot read the ownership ledger');
      return;
    }
    for (const resource of live.value) await this.sweepOne(resource);
  }

  private async sweepOne(resource: SourceResource): Promise<void> {
    const acquisitionId = resource.acquisitionId;
    const terminal = await this.isTerminal(acquisitionId);
    if (terminal.isErr()) {
      this.deps.logger.error(
        { err: terminal.error, acquisitionId },
        'sweep: terminal check failed',
      );
      return;
    }
    if (!terminal.value) return; // an in-flight acquisition still owns this — leave it to the reactor

    const removed = await this.deps.remover.remove(resource);
    if (removed.isErr()) {
      this.deps.logger.warn(
        { err: removed.error, acquisitionId },
        'sweep: source removal failed; will retry next boot',
      );
      return;
    }
    if (!removed.value) {
      // The record was cancelled but has not yet transitioned to removable — leave the row live so
      // the next boot's sweep converges it (design D1), rather than marking a lingering record gone.
      this.deps.logger.debug(
        { acquisitionId },
        'sweep: record not yet confirmed gone; will retry next boot',
      );
      return;
    }
    const marked = await this.deps.ledger.markRemoved(resource);
    if (marked.isErr()) {
      this.deps.logger.warn({ err: marked.error, acquisitionId }, 'sweep: markRemoved failed');
    }
  }

  private isTerminal(acquisitionId: string): ResultAsync<boolean, InfraError> {
    return this.deps.store
      .readStream(acquisitionId)
      .map((stored) => Acquisition.fromHistory(stored.map((entry) => entry.event)).isTerminal);
  }
}
