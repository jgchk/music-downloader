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
import type { Logger } from '../../application/logging/logger.js';
import { candidateStagingDir } from '../filesystem/paths.js';
import { SlskdClient } from './client.js';
import type { SlskdConfig } from './client.js';
import { remoteFilename } from './mapping.js';
import { realTimer } from './timer.js';
import type { Timer } from './timer.js';
import { aggregate, flattenDownloads } from './transfers.js';
import type { SlskdTransfer } from './transfers.js';

/**
 * The slskd `DownloadPort` adapter (D10). It enqueues a candidate's files, polls slskd for
 * progress (surfaced live via `onProgress`, never as events — D1), and aggregates the per-file
 * transfers into a single candidate-level outcome. It owns the *detection* of stalls and hopeless
 * queues against the policy's thresholds (the policy stays source-agnostic), cancelling the
 * transfers and reporting a source-agnostic reason. Completed files are reported at their staging
 * location so the library adapter can import (or `discardStaging`) them.
 */

const DEFAULT_POLL_INTERVAL_MS = 1_000;

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
    config: SlskdDownloadConfig,
    client: SlskdClient = new SlskdClient(),
    private readonly timer: Timer = realTimer,
  ) {
    this.client = client;
    this.stagingRoot = config.stagingRoot;
    this.pollIntervalMs = config.pollIntervalMs ?? DEFAULT_POLL_INTERVAL_MS;
  }

  download(
    candidate: Candidate,
    policy: DownloadPolicy,
    onProgress: (progress: DownloadProgress) => void,
  ): ResultAsync<DownloadResult, InfraError> {
    return ResultAsync.fromPromise(this.doDownload(candidate, policy, onProgress), (cause) =>
      infraError('slskd.download', String(cause), cause),
    );
  }

  private async doDownload(
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
    this.logger.debug({ username, fileCount: requests.length }, 'enqueueing slskd download');
    await this.client.post(this.downloadsPath(username), requests);

    const start = this.timer.now();
    let lastBytes = 0;
    let lastProgressAt = start;
    for (;;) {
      const mine = flattenDownloads(await this.client.get(this.downloadsPath(username))).filter(
        (transfer) => wanted.has(transfer.filename ?? ''),
      );
      const status = aggregate(mine);
      onProgress(status.progress);

      if (status.settled) {
        if (status.succeeded) {
          this.logger.debug({ username }, 'slskd download completed');
          return { kind: 'completed', files: this.stagedFiles(candidate) };
        }
        this.logger.warn({ username, reason: status.failureReason }, 'slskd download failed');
        return { kind: 'failed', reason: status.failureReason };
      }

      const now = this.timer.now();
      if (status.progress.bytesTransferred > lastBytes) {
        lastBytes = status.progress.bytesTransferred;
        lastProgressAt = now;
      }
      if (status.allQueued && now - start >= policy.maxQueueWaitMs) {
        return this.abandon(username, mine, 'QueueTimeout');
      }
      if (!status.allQueued && now - lastProgressAt >= policy.stallTimeoutMs) {
        return this.abandon(username, mine, 'Stalled');
      }
      await this.timer.sleep(this.pollIntervalMs);
    }
  }

  private async abandon(
    username: string,
    transfers: readonly SlskdTransfer[],
    reason: DownloadFailureReason,
  ): Promise<DownloadResult> {
    this.logger.warn({ username, reason }, 'abandoning slskd download');
    for (const transfer of transfers) {
      await this.client.del(
        `${this.downloadsPath(username)}/${encodeURIComponent(transfer.id ?? '')}`,
      );
    }
    return { kind: 'failed', reason };
  }

  private stagedFiles(candidate: Candidate): DownloadedFile[] {
    const dir = candidateStagingDir(this.stagingRoot, candidate.identity);
    return candidate.files.map((file) => ({ name: file.name, path: join(dir, file.name) }));
  }

  private downloadsPath(username: string): string {
    return `/api/v0/transfers/downloads/${encodeURIComponent(username)}`;
  }
}
