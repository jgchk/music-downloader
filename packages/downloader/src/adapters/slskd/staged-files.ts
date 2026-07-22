import type { DownloadedFile } from '../../domain/acquisition/events.js';
import type { Candidate } from '../../domain/candidate/candidate.js';
import type { Logger } from '../../application/logging/logger.js';
import type { SlskdClient } from './client.js';
import { remoteFilename } from './mapping.js';
import { slskdEventsSchema, slskdOptionsSchema } from './schemas.js';
import { resolveStagedPaths } from './staged-location.js';
import type { Timer } from './timer.js';
import { isTransferSucceeded } from './transfers.js';
import type { OwnedTransfer } from './transfers.js';

/**
 * Resolves the *actual* on-disk location slskd wrote each completed file — read from slskd's
 * `DownloadFileComplete` events (`localFilename`, correlated by `transfer.id`) and re-rooted onto
 * `STAGING_ROOT` — so the library adapter imports (or `discardStaging`s) real, existing paths
 * rather than a location recomputed from candidate identity (slskd-report-staged-location D1/D2).
 * The staged location is
 * never derived from slskd's OS / destination template / sanitizer; those are slskd's alone. The
 * resolver itself never touches the filesystem.
 */

/** One page of slskd's newest-first events log; our just-completed events sit at its head. */
const EVENTS_PAGE_LIMIT = 100;
/** How many times to re-poll the events log for an id whose completion event still lags. */
const MAX_EVENT_POLLS = 5;

export class StagedFileResolver {
  /** slskd's downloads root, read once from `/api/v0/options`; it does not change at runtime. */
  private cachedDownloadsRoot?: string;

  constructor(
    private readonly logger: Logger,
    private readonly client: SlskdClient,
    private readonly timer: Timer,
    private readonly stagingRoot: string,
    private readonly pollIntervalMs: number,
  ) {}

  /**
   * Report each completed file at the real path slskd wrote, correlated to our transfers by id.
   * The clean candidate file name is kept for the library; only the *path* comes from slskd.
   */
  async stagedFiles(
    transfers: readonly OwnedTransfer[],
    candidate: Candidate,
  ): Promise<DownloadedFile[]> {
    const downloadsRoot = await this.downloadsRoot();
    const wantedIds = new Set(transfers.map((transfer) => transfer.id!));
    const resolved = await this.resolveStaged(wantedIds, downloadsRoot);
    const nameByRemote = new Map(
      candidate.files.map((file) => [
        remoteFilename(candidate.identity.path, file.name),
        file.name,
      ]),
    );
    return transfers.map((transfer) => ({
      name: nameByRemote.get(transfer.filename)!,
      path: resolved.get(transfer.id!)!,
    }));
  }

  /**
   * Resolve the staged locations of the transfers that succeeded before the candidate was abandoned
   * or doomed, so the domain can clean them (slskd-abandon-full-teardown D2). Best-effort
   * (slskd-abandon-full-teardown D3): a resolution fault (the
   * events log lagging, a bad options body) yields no files rather than turning the settled failure
   * into an infra fault — the orphaned files fall to a later reconciliation instead of wedging retry.
   */
  async completedStagedFiles(
    mine: readonly OwnedTransfer[],
    candidate: Candidate,
  ): Promise<readonly DownloadedFile[]> {
    const completed = mine.filter(
      (transfer) => isTransferSucceeded(transfer) && transfer.id !== undefined,
    );
    if (completed.length === 0) return [];
    try {
      return await this.stagedFiles(completed, candidate);
    } catch (err) {
      this.logger.warn(
        { err, username: candidate.identity.username },
        'could not resolve the abandoned candidate’s completed files',
      );
      return [];
    }
  }

  /**
   * Page the newest-first events log for our completed transfers, re-rooting each onto the staging
   * volume (slskd-report-staged-location D2). Our events sit at the head right after completion;
   * the scan walks older
   * pages until every id resolves or a page comes back empty (log exhausted). An id can lag its
   * transfer-state flip by moments, so an exhausted log triggers a bounded re-poll from the top;
   * persistent absence is an infra fault the acquisition retry then handles.
   */
  private async resolveStaged(
    wantedIds: ReadonlySet<string>,
    downloadsRoot: string,
  ): Promise<Map<string, string>> {
    const resolved = new Map<string, string>();
    let offset = 0;
    let polls = 0;
    for (;;) {
      const events = slskdEventsSchema.parse(await this.client.events(offset, EVENTS_PAGE_LIMIT));
      for (const [id, path] of resolveStagedPaths(
        wantedIds,
        events,
        downloadsRoot,
        this.stagingRoot,
      )) {
        resolved.set(id, path);
      }
      if (resolved.size === wantedIds.size) return resolved;
      if (events.length > 0) {
        offset += EVENTS_PAGE_LIMIT; // older events remain to scan before concluding it hasn't arrived
        continue;
      }
      if (++polls >= MAX_EVENT_POLLS) {
        throw new Error(
          `slskd events did not report ${wantedIds.size - resolved.size} completed file(s)`,
        );
      }
      offset = 0; // re-scan from the head after the lag window
      await this.timer.sleep(this.pollIntervalMs);
    }
  }

  private async downloadsRoot(): Promise<string> {
    if (this.cachedDownloadsRoot === undefined) {
      const options = slskdOptionsSchema.parse(await this.client.options());
      this.cachedDownloadsRoot = options.directories.downloads;
    }
    return this.cachedDownloadsRoot;
  }
}
