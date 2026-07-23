import type { Logger } from '../../application/logging/logger.js';
import { downloadsPath } from './client.js';
import type { SlskdClient } from './client.js';
import { pollOwnedTransfers } from './poll.js';
import type { Timer } from './timer.js';
import { isTransferComplete } from './transfers.js';
import type { OwnedTransfer } from './transfers.js';

/**
 * Two-phase teardown of owned transfers at the source (slskd-abandon-full-teardown D1). slskd's
 * synchronous remove is guarded on the `Completed` flag, so an in-flight transfer is cancelled with
 * `?remove=false` (a `?remove=true` would 500), re-polled until it carries the flag, and removed
 * with `?remove=true`; an already-terminal transfer is removed on the first pass with no re-poll.
 * Removal faults are absorbed — the outcome is already decided, so a failed DELETE (or a record
 * slskd already dropped) leaves the transfer unconfirmed rather than erroring; a between-round
 * re-poll fault still propagates to the caller.
 */

/**
 * How many cancel→poll→remove rounds teardown attempts before leaving an unconfirmed transfer to
 * the startup sweep (slskd-abandon-full-teardown D1). Cancellation transitions a transfer to
 * terminal asynchronously, so a small bound absorbs that lag without blocking a settled/abandoned
 * outcome on a flaky transition.
 */
const MAX_REMOVE_ROUNDS = 3;

export class TransferTeardown {
  constructor(
    private readonly logger: Logger,
    private readonly client: SlskdClient,
    private readonly timer: Timer,
    private readonly pollIntervalMs: number,
  ) {}

  /**
   * Cancel each present transfer and remove its record once terminal, confirming the record is
   * gone. Bounded by {@link MAX_REMOVE_ROUNDS}; returns the filenames still present at the source
   * when the bound is hit, so the caller keeps their ledger rows live.
   */
  async teardown(
    username: string,
    present: readonly OwnedTransfer[],
    wanted: ReadonlySet<string>,
  ): Promise<Set<string>> {
    let current = present;
    for (let round = 1; ; round++) {
      const unconfirmed: OwnedTransfer[] = [];
      for (const transfer of current) {
        const isTerminal = isTransferComplete(transfer);
        try {
          await this.client.delIfPresent(
            `${downloadsPath(username)}/${encodeURIComponent(transfer.id ?? '')}?remove=${isTerminal}`,
          );
          if (!isTerminal) unconfirmed.push(transfer); // cancelled — must re-poll to confirm removal
        } catch (error) {
          this.logger.warn({ err: error, username }, 'failed to tear down a slskd transfer');
          unconfirmed.push(transfer);
        }
      }
      if (unconfirmed.length === 0) return new Set(); // every terminal record removed cleanly
      if (round >= MAX_REMOVE_ROUNDS)
        return new Set(unconfirmed.map((transfer) => transfer.filename));
      await this.timer.sleep(this.pollIntervalMs);
      current = await pollOwnedTransfers(this.client, username, wanted);
      if (current.length === 0) return new Set(); // the cancelled records transitioned and are gone
    }
  }
}
