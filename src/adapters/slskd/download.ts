import { join } from 'node:path';
import { ResultAsync } from 'neverthrow';
import type { Candidate } from '../../domain/candidate/candidate.js';
import type { DownloadPolicy } from '../../domain/policy/policies.js';
import type { DownloadFailureReason, DownloadedFile } from '../../domain/acquisition/events.js';
import { infraError } from '../../application/ports/errors.js';
import type { InfraError } from '../../application/ports/errors.js';
import type {
  DownloadPort,
  DownloadProgress,
  DownloadResult,
} from '../../application/ports/outbound-ports.js';
import type {
  ResourceLedgerStore,
  SourceResourceKey,
} from '../../application/ports/resource-ledger-port.js';
import type { Logger } from '../../application/logging/logger.js';
import { candidateStagingDir } from '../filesystem/paths.js';
import { SlskdClient } from './client.js';
import type { SlskdConfig } from './client.js';
import { remoteFilename } from './mapping.js';
import { slskdTransfersSchema } from './schemas.js';
import { realTimer } from './timer.js';
import type { Timer } from './timer.js';
import { aggregate, flattenDownloads } from './transfers.js';
import type { SlskdTransfer } from './transfers.js';

/**
 * The slskd `DownloadPort` adapter (D10). It enqueues a candidate's files, polls slskd for progress
 * (surfaced live via `onProgress`, never as events — D1), and aggregates the per-file transfers into
 * a single candidate-level outcome. It owns the *detection* of stalls and hopeless queues against the
 * policy's thresholds (the policy stays source-agnostic), and dooms the whole candidate the moment
 * any file fails rather than downloading the rest of a release it will reject. Completed files are
 * reported at their staging location so the library adapter can import (or `discardStaging`) them.
 *
 * Every transfer is recorded in the ownership ledger write-ahead (before enqueue) and its record is
 * removed from slskd on every terminal outcome — completed, failed, doomed, or abandoned — so records
 * from one attempt can never contaminate a later attempt's outcome (D: source-resource stewardship).
 * Ledger bookkeeping is best-effort: the adapter's own correctness rests on the in-memory owned set
 * and the live slskd payload, so a ledger fault degrades sweep coverage but never a working download.
 */

const DEFAULT_POLL_INTERVAL_MS = 1_000;
const SLSKD_SOURCE = 'slskd';

export interface SlskdDownloadConfig extends SlskdConfig {
  /** Root under which each candidate's files are staged (shared with the filesystem library). */
  readonly stagingRoot: string;
}

export class SlskdDownload implements DownloadPort {
  private readonly client: SlskdClient;
  private readonly pollIntervalMs: number;
  private readonly stagingRoot: string;

  constructor(
    private readonly logger: Logger,
    private readonly ledger: ResourceLedgerStore,
    config: SlskdDownloadConfig,
    client: SlskdClient = new SlskdClient(),
    private readonly timer: Timer = realTimer,
  ) {
    this.client = client;
    this.stagingRoot = config.stagingRoot;
    this.pollIntervalMs = config.pollIntervalMs ?? DEFAULT_POLL_INTERVAL_MS;
  }

  download(
    acquisitionId: string,
    candidate: Candidate,
    policy: DownloadPolicy,
    onProgress: (progress: DownloadProgress) => void,
  ): ResultAsync<DownloadResult, InfraError> {
    return ResultAsync.fromPromise(
      this.doDownload(acquisitionId, candidate, policy, onProgress),
      (cause) => infraError('slskd.download', String(cause), cause),
    );
  }

  private async doDownload(
    acquisitionId: string,
    candidate: Candidate,
    policy: DownloadPolicy,
    onProgress: (progress: DownloadProgress) => void,
  ): Promise<DownloadResult> {
    const { username } = candidate.identity;
    const requests = candidate.files.map((file) => ({
      filename: remoteFilename(candidate.identity.path, file.name),
      size: file.sizeBytes,
    }));
    const wanted = new Set(requests.map((request) => request.filename));
    const ownedKeys = requests.map((request) =>
      this.transferKey(acquisitionId, username, request.filename),
    );

    // Write-ahead: record ownership before the enqueue, so a crash still leaves the sweep a trail.
    for (const key of ownedKeys)
      await this.record(this.ledger.recordCreated({ ...key }), 'record transfer');
    this.logger.debug({ username, fileCount: requests.length }, 'enqueueing slskd download');
    await this.client.post(this.downloadsPath(username), requests);

    const start = this.timer.now();
    let lastBytes = 0;
    let lastProgressAt = start;
    const captured = new Set<string>();
    for (;;) {
      const payload = slskdTransfersSchema.parse(
        await this.client.get(this.downloadsPath(username)),
      );
      const mine = flattenDownloads(payload).filter(
        (transfer): transfer is SlskdTransfer & { filename: string } =>
          transfer.filename !== undefined && wanted.has(transfer.filename),
      );
      await this.captureIds(acquisitionId, username, mine, captured);
      const status = aggregate(mine);
      onProgress(status.progress);

      if (status.succeeded) {
        this.logger.debug({ username }, 'slskd download completed');
        await this.removeOwned(username, mine, ownedKeys);
        return { kind: 'completed', files: this.stagedFiles(candidate) };
      }
      if (status.hasFailure) {
        // One failed file dooms the candidate: cancel the rest (via the `?remove=true` sweep below)
        // and report the original failure, not the cancellation it triggers.
        this.logger.warn({ username, reason: status.failureReason }, 'slskd download failed');
        await this.removeOwned(username, mine, ownedKeys);
        return { kind: 'failed', reason: status.failureReason };
      }

      const now = this.timer.now();
      if (status.progress.bytesTransferred > lastBytes) {
        lastBytes = status.progress.bytesTransferred;
        lastProgressAt = now;
      }
      if (status.allQueued && now - start >= policy.maxQueueWaitMs) {
        return this.abandon(username, mine, ownedKeys, 'QueueTimeout');
      }
      if (!status.allQueued && now - lastProgressAt >= policy.stallTimeoutMs) {
        return this.abandon(username, mine, ownedKeys, 'Stalled');
      }
      await this.timer.sleep(this.pollIntervalMs);
    }
  }

  /**
   * Cancel the acquisition's in-flight transfers at the source and remove their records (D:
   * cancellation). Called when a downloading acquisition is cancelled; idempotent, so a transfer
   * already settled or absent is tolerated and a redelivered abort is safe.
   */
  abort(acquisitionId: string, candidate: Candidate): ResultAsync<void, InfraError> {
    return ResultAsync.fromPromise(this.doAbort(acquisitionId, candidate), (cause) =>
      infraError('slskd.abort', String(cause), cause),
    );
  }

  private async doAbort(acquisitionId: string, candidate: Candidate): Promise<void> {
    const { username } = candidate.identity;
    const filenames = candidate.files.map((file) =>
      remoteFilename(candidate.identity.path, file.name),
    );
    const wanted = new Set(filenames);
    const ownedKeys = filenames.map((filename) =>
      this.transferKey(acquisitionId, username, filename),
    );
    const payload = slskdTransfersSchema.parse(await this.client.get(this.downloadsPath(username)));
    const mine = flattenDownloads(payload).filter((transfer) =>
      wanted.has(transfer.filename ?? ''),
    );
    this.logger.debug({ username, count: mine.length }, 'aborting slskd download');
    await this.removeOwned(username, mine, ownedKeys);
  }

  /** Report a policy abandonment: cancel + remove the owned transfers, then surface the reason. */
  private async abandon(
    username: string,
    mine: readonly SlskdTransfer[],
    ownedKeys: readonly SourceResourceKey[],
    reason: DownloadFailureReason,
  ): Promise<DownloadResult> {
    this.logger.warn({ username, reason }, 'abandoning slskd download');
    await this.removeOwned(username, mine, ownedKeys);
    return { kind: 'failed', reason };
  }

  /**
   * Cancel + remove each present owned transfer (`?remove=true`) and mark the ledger rows removed.
   * Best-effort: the outcome is already decided, so a removal fault (or a record slskd already
   * dropped) must never turn a settled download into an error — the sweep retires any leftover.
   */
  private async removeOwned(
    username: string,
    mine: readonly SlskdTransfer[],
    ownedKeys: readonly SourceResourceKey[],
  ): Promise<void> {
    for (const transfer of mine) {
      try {
        await this.client.delIfPresent(
          `${this.downloadsPath(username)}/${encodeURIComponent(transfer.id ?? '')}?remove=true`,
        );
      } catch (err) {
        this.logger.warn({ err, username }, 'failed to remove a settled slskd transfer');
      }
    }
    for (const key of ownedKeys)
      await this.record(this.ledger.markRemoved(key), 'mark transfer removed');
  }

  /** Attach each newly-seen transfer's slskd GUID to its ledger row, so the sweep can delete it. */
  private async captureIds(
    acquisitionId: string,
    username: string,
    mine: readonly (SlskdTransfer & { filename: string })[],
    captured: Set<string>,
  ): Promise<void> {
    for (const transfer of mine) {
      const { id, filename } = transfer;
      if (id === undefined || captured.has(filename)) continue;
      captured.add(filename);
      const key = this.transferKey(acquisitionId, username, filename);
      await this.record(this.ledger.recordId(key, id), 'record transfer id');
    }
  }

  /** Run a ledger write without letting a stewardship fault fail an otherwise-working download. */
  private async record(op: ResultAsync<void, InfraError>, what: string): Promise<void> {
    const result = await op;
    if (result.isErr()) this.logger.warn({ err: result.error }, `ledger: ${what} failed`);
  }

  private transferKey(
    acquisitionId: string,
    username: string,
    filename: string,
  ): SourceResourceKey {
    return {
      source: SLSKD_SOURCE,
      kind: 'transfer',
      resourceKey: `${username}|${filename}`,
      acquisitionId,
    };
  }

  private stagedFiles(candidate: Candidate): DownloadedFile[] {
    const dir = candidateStagingDir(this.stagingRoot, candidate.identity);
    return candidate.files.map((file) => ({ name: file.name, path: join(dir, file.name) }));
  }

  private downloadsPath(username: string): string {
    return `/api/v0/transfers/downloads/${encodeURIComponent(username)}`;
  }
}
