import { ResultAsync } from 'neverthrow';
import { infraError } from '../../application/ports/errors.js';
import type { InfraError } from '../../application/ports/errors.js';
import type {
  SourceResource,
  SourceResourceRemover,
} from '../../application/ports/resource-ledger-port.js';
import type { Logger } from '../../application/logging/logger.js';
import { downloadsPath, SlskdClient } from './client.js';
import { slskdTransfersSchema } from './schemas.js';
import { realTimer } from './timer.js';
import type { Timer } from './timer.js';
import { flattenDownloads, isTransferComplete } from './transfers.js';
import type { SlskdTransfer } from './transfers.js';

const DEFAULT_POLL_INTERVAL_MS = 1000;
/** Cancel→poll→remove rounds before leaving an unconfirmed transfer to the next boot's sweep (D1). */
const MAX_REMOVE_ROUNDS = 3;

/**
 * The slskd arm of the startup sweep (D: source-resource stewardship): removes a resource the app
 * recorded in the ownership ledger. A search is deleted by its id. A transfer is torn down with the
 * two-step confirm teardown (design D1): an in-flight transfer is cancelled (`?remove=false`, since
 * slskd's synchronous remove is guarded on the `Completed` flag and would 500), re-polled until it
 * carries the flag, then removed (`?remove=true`); an already-terminal transfer is removed directly.
 * A GUID captured before a crash locates the transfer alongside its filename. `remove` resolves to
 * whether the record is *confirmed gone*: a transfer still lingering after the bound resolves `false`
 * so the sweep leaves its ledger row live to retry next boot. Deleting something already gone is a
 * tolerated no-op, so the sweep is idempotent.
 */
export class SlskdResourceRemover implements SourceResourceRemover {
  private readonly pollIntervalMs: number;

  constructor(
    private readonly logger: Logger,
    private readonly client: SlskdClient = new SlskdClient(),
    private readonly timer: Timer = realTimer,
    pollIntervalMs: number = DEFAULT_POLL_INTERVAL_MS,
  ) {
    this.pollIntervalMs = pollIntervalMs;
  }

  remove(resource: SourceResource): ResultAsync<boolean, InfraError> {
    return ResultAsync.fromPromise(this.doRemove(resource), (cause) =>
      infraError('slskd.resource-remove', String(cause), cause),
    );
  }

  private async doRemove(resource: SourceResource): Promise<boolean> {
    if (resource.kind === 'search') {
      this.logger.debug({ id: resource.resourceKey }, 'sweeping slskd search');
      await this.client.delIfPresent(
        `/api/v0/searches/${encodeURIComponent(resource.resourceKey)}`,
      );
      return true; // a search is removed synchronously — nothing to confirm across a transition
    }
    const separator = resource.resourceKey.indexOf('|');
    const username = resource.resourceKey.slice(0, separator);
    const filename = resource.resourceKey.slice(separator + 1);
    return this.teardownTransfer(username, filename, resource.resourceId);
  }

  /**
   * Cancel + remove the transfer, confirming its record is gone (design D1). Returns `true` once the
   * transfer is absent from a re-poll, `false` if it still lingers after {@link MAX_REMOVE_ROUNDS}.
   */
  private async teardownTransfer(
    username: string,
    filename: string,
    capturedId: string | undefined,
  ): Promise<boolean> {
    let current = await this.findTransfer(username, filename, capturedId);
    for (let round = 1; ; round++) {
      if (current === undefined) return true; // confirmed gone
      const isTerminal = isTransferComplete(current);
      const id = current.id ?? capturedId ?? '';
      this.logger.debug({ username, id, terminal: isTerminal }, 'sweeping slskd transfer');
      await this.client.delIfPresent(
        `${downloadsPath(username)}/${encodeURIComponent(id)}?remove=${isTerminal}`,
      );
      if (round >= MAX_REMOVE_ROUNDS) break;
      await this.timer.sleep(this.pollIntervalMs);
      current = await this.findTransfer(username, filename, capturedId);
    }
    return (await this.findTransfer(username, filename, capturedId)) === undefined;
  }

  /** Find our transfer in the user's downloads, by filename or the GUID captured before a crash. */
  private async findTransfer(
    username: string,
    filename: string,
    capturedId: string | undefined,
  ): Promise<SlskdTransfer | undefined> {
    // slskd 404s the downloads collection for a user with no transfers — a *state*, not a fault. A
    // swept transfer that is already gone must fold to an empty listing (transfer not found →
    // confirmed gone → ledger row retired), never a retryable fault that leaves the row live forever
    // (prod 2026-07-22, mirroring the download poll's `getOr`).
    const payload = slskdTransfersSchema.parse(
      await this.client.getOr(downloadsPath(username), {}),
    );
    return flattenDownloads(payload).find(
      (transfer) =>
        transfer.filename === filename || (capturedId !== undefined && transfer.id === capturedId),
    );
  }
}
