import { downloadsPath } from './client.js';
import type { SlskdClient } from './client.js';
import { slskdTransfersSchema } from './schemas.js';
import { flattenDownloads } from './transfers.js';
import type { OwnedTransfer } from './transfers.js';

/**
 * The shared ownership-narrowed poll of a user's downloads: one page, filtered to the transfers
 * the caller owns. A 404 means the user has no transfers at slskd — a state, not a fault — so it
 * folds to an empty page and the caller's budgets settle the outcome instead of wedging retry on a
 * vanished collection (prod 2026-07-22).
 */
export async function pollOwnedTransfers(
  client: SlskdClient,
  username: string,
  wanted: ReadonlySet<string>,
): Promise<OwnedTransfer[]> {
  const payload = slskdTransfersSchema.parse(await client.getOr(downloadsPath(username), {}));
  return flattenDownloads(payload).filter(
    (transfer): transfer is OwnedTransfer =>
      transfer.filename !== undefined && wanted.has(transfer.filename),
  );
}
