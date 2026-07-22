import type { ResultAsync } from 'neverthrow';
import type { InfraError } from '../../application/ports/errors.js';
import type { Logger } from '../../application/logging/logger.js';
import type {
  ResourceLedgerStore,
  SourceResourceKey,
} from '../../application/ports/resource-ledger-port.js';
import type { OwnedTransfer } from './transfers.js';

/**
 * Ledger stewardship for the transfers a download attempt owns (D: source-resource stewardship).
 * Keys are recorded write-ahead (before the enqueue) so a crash still leaves the startup sweep a
 * trail, slskd GUIDs are attached as they are first reported, and rows are marked removed only for
 * records confirmed gone at the source. Every write is best-effort: `SlskdDownload`'s own
 * correctness rests on its in-memory owned set and the live slskd payload, so a ledger fault
 * degrades sweep coverage but never a working download.
 */

const SLSKD_SOURCE = 'slskd';

/** The remote filename half of a transfer ledger key (`${username}|${filename}`). */
export function filenameOfKey(key: SourceResourceKey): string {
  return key.resourceKey.slice(key.resourceKey.indexOf('|') + 1);
}

export class TransferLedger {
  constructor(
    private readonly logger: Logger,
    private readonly ledger: ResourceLedgerStore,
  ) {}

  keyFor(acquisitionId: string, username: string, filename: string): SourceResourceKey {
    return {
      source: SLSKD_SOURCE,
      kind: 'transfer',
      resourceKey: `${username}|${filename}`,
      acquisitionId,
    };
  }

  /** Must run before the enqueue (write-ahead), so a crash still leaves the sweep a trail. */
  async recordCreated(keys: readonly SourceResourceKey[]): Promise<void> {
    for (const key of keys) {
      await this.record(this.ledger.recordCreated({ ...key }), 'record transfer');
    }
  }

  /** Release write-ahead rows for an enqueue slskd refused: nothing was created at the source. */
  async release(keys: readonly SourceResourceKey[]): Promise<void> {
    for (const key of keys) {
      await this.record(this.ledger.markRemoved(key), 'release rejected transfer');
    }
  }

  /** Attach each newly-seen transfer's slskd GUID to its ledger row, so the sweep can delete it. */
  async captureIds(
    acquisitionId: string,
    username: string,
    mine: readonly OwnedTransfer[],
    captured: Set<string>,
  ): Promise<void> {
    for (const transfer of mine) {
      const { id, filename } = transfer;
      if (id === undefined || captured.has(filename)) continue;
      captured.add(filename);
      const key = this.keyFor(acquisitionId, username, filename);
      await this.record(this.ledger.recordId(key, id), 'record transfer id');
    }
  }

  /**
   * Mark rows removed for the records teardown confirmed gone; a filename still present at the
   * source keeps its row live so the startup sweep retires it (slskd-abandon-full-teardown D1).
   */
  async markRemoved(
    keys: readonly SourceResourceKey[],
    stillPresent: ReadonlySet<string>,
  ): Promise<void> {
    for (const key of keys) {
      if (stillPresent.has(filenameOfKey(key))) continue;
      await this.record(this.ledger.markRemoved(key), 'mark transfer removed');
    }
  }

  /** Run a ledger write without letting a stewardship fault fail an otherwise-working download. */
  private async record(op: ResultAsync<void, InfraError>, what: string): Promise<void> {
    const result = await op;
    if (result.isErr()) this.logger.warn({ err: result.error }, `ledger: ${what} failed`);
  }
}
