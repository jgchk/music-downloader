import { join, relative } from 'node:path';
import { slskdDownloadFileCompleteSchema } from './schemas.js';
import type { SlskdEventRecord } from './schemas.js';

/**
 * Resolve where slskd actually wrote each of our completed downloads, correlated by transfer id
 * (design D1/D2). slskd's `DownloadFileComplete` events carry the authoritative `localFilename`
 * (whatever its OS / destination template / sanitizer / collision-rename produced) alongside the
 * `transfer.id` returned by our downloads poll — so we read the path rather than re-derive slskd's
 * on-disk scheme. `localFilename` is slskd's *container* path under its downloads root; the same
 * bytes are visible to us under `stagingRoot` (a shared volume), so we re-root the prefix:
 * `join(stagingRoot, relative(downloadsRoot, localFilename))`.
 *
 * Pure and total: it scans one already-parsed page of events, decodes only the completion records
 * (each event type's `data` payload differs), and returns a map of `transfer.id → our path` for the
 * ids we asked for. Ids not present on this page are simply absent from the result — the caller
 * pages/retries (events can lag the transfer-state flip) and treats persistent absence as a fault.
 */

const DOWNLOAD_FILE_COMPLETE = 'DownloadFileComplete';

export function resolveStagedPaths(
  wantedIds: ReadonlySet<string>,
  events: readonly SlskdEventRecord[],
  downloadsRoot: string,
  stagingRoot: string,
): Map<string, string> {
  const resolved = new Map<string, string>();
  for (const record of events) {
    if (record.type !== DOWNLOAD_FILE_COMPLETE) continue;
    const { localFilename, transfer } = slskdDownloadFileCompleteSchema.parse(
      JSON.parse(record.data) as unknown,
    );
    if (!wantedIds.has(transfer.id)) continue;
    resolved.set(transfer.id, join(stagingRoot, relative(downloadsRoot, localFilename)));
  }
  return resolved;
}
