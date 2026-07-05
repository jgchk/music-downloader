import { ResultAsync } from 'neverthrow';
import { infraError } from '../../application/ports/errors.js';
import type { InfraError } from '../../application/ports/errors.js';
import type {
  SourceResource,
  SourceResourceRemover,
} from '../../application/ports/resource-ledger-port.js';
import type { Logger } from '../../application/logging/logger.js';
import { SlskdClient } from './client.js';
import { slskdTransfersSchema } from './schemas.js';
import { flattenDownloads } from './transfers.js';

/**
 * The slskd arm of the startup sweep (D: source-resource stewardship): removes a resource the app
 * recorded in the ownership ledger. A search is deleted by its id; a transfer is cancelled+removed by
 * its slskd GUID, falling back to a filename lookup when the GUID was never captured (a crash before
 * the first poll). Deleting something already gone is a tolerated no-op, so the sweep is idempotent.
 */
export class SlskdResourceRemover implements SourceResourceRemover {
  constructor(
    private readonly logger: Logger,
    private readonly client: SlskdClient = new SlskdClient(),
  ) {}

  remove(resource: SourceResource): ResultAsync<void, InfraError> {
    return ResultAsync.fromPromise(this.doRemove(resource), (cause) =>
      infraError('slskd.resource-remove', String(cause), cause),
    );
  }

  private async doRemove(resource: SourceResource): Promise<void> {
    if (resource.kind === 'search') {
      this.logger.debug({ id: resource.resourceKey }, 'sweeping slskd search');
      await this.client.delIfPresent(
        `/api/v0/searches/${encodeURIComponent(resource.resourceKey)}`,
      );
      return;
    }
    const separator = resource.resourceKey.indexOf('|');
    const username = resource.resourceKey.slice(0, separator);
    const filename = resource.resourceKey.slice(separator + 1);
    const id = resource.resourceId ?? (await this.lookupTransferId(username, filename));
    if (id === undefined) return; // the transfer is already gone from the source
    this.logger.debug({ username, id }, 'sweeping slskd transfer');
    await this.client.delIfPresent(
      `/api/v0/transfers/downloads/${encodeURIComponent(username)}/${encodeURIComponent(id)}?remove=true`,
    );
  }

  private async lookupTransferId(username: string, filename: string): Promise<string | undefined> {
    const payload = slskdTransfersSchema.parse(
      await this.client.get(`/api/v0/transfers/downloads/${encodeURIComponent(username)}`),
    );
    return flattenDownloads(payload).find((transfer) => transfer.filename === filename)?.id;
  }
}
