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
import { downloadsPath, SlskdClient } from './client.js';
import type { SlskdConfig } from './client.js';
import { remoteFilename } from './mapping.js';
import { pollOwnedTransfers } from './poll.js';
import { StagedFileResolver } from './staged-files.js';
import { TransferLedger, filenameOfKey } from './transfer-ledger.js';
import { TransferTeardown } from './teardown.js';
import { realTimer } from './timer.js';
import type { Timer } from './timer.js';
import { aggregate, enqueueRejectionReason } from './transfers.js';
import type { OwnedTransfer } from './transfers.js';

/**
 * The slskd `DownloadPort` adapter (D10). It enqueues a candidate's files, polls slskd for progress
 * (surfaced live via `onProgress`, never as events — D1), and aggregates the per-file transfers into
 * a single candidate-level outcome. It owns the *detection* of stalls and hopeless queues against the
 * policy's thresholds (the policy stays source-agnostic), and dooms the whole candidate the moment
 * any file fails rather than downloading the rest of a release it will reject.
 *
 * The orthogonal concerns are collaborators, composed here from the adapter's own dependencies:
 * completed files are reported at the actual on-disk location slskd wrote them by the
 * {@link StagedFileResolver}; ownership rows are recorded write-ahead and retired by the
 * {@link TransferLedger}; and every terminal outcome — completed, failed, doomed, or abandoned —
 * tears its transfers down at the source via the two-phase {@link TransferTeardown}, so records
 * from one attempt can never contaminate a later attempt's outcome (D: source-resource
 * stewardship). A teardown not confirmed within its bound leaves the ledger row live so the
 * startup sweep retires it — the backstop for unconfirmed removals.
 *
 * Deployment prerequisites (out of this codebase, tracked in the deploy repo): `STAGING_ROOT` must
 * point at the same volume as slskd's downloads directory, and slskd must run as `PUID/PGID=1000`
 * so the app (uid 1000) can move/unlink the files slskd wrote.
 */

const DEFAULT_POLL_INTERVAL_MS = 1000;

export interface SlskdDownloadConfig extends SlskdConfig {
  /** Root under which each candidate's files are staged (shared with the filesystem library). */
  readonly stagingRoot: string;
}

export class SlskdDownload implements DownloadPort {
  private readonly client: SlskdClient;
  private readonly pollIntervalMs: number;
  private readonly transferLedger: TransferLedger;
  private readonly teardown: TransferTeardown;
  private readonly staged: StagedFileResolver;

  constructor(
    private readonly logger: Logger,
    ledger: ResourceLedgerStore,
    config: SlskdDownloadConfig,
    client: SlskdClient = new SlskdClient(),
    private readonly timer: Timer = realTimer,
  ) {
    this.client = client;
    this.pollIntervalMs = config.pollIntervalMs ?? DEFAULT_POLL_INTERVAL_MS;
    this.transferLedger = new TransferLedger(logger, ledger);
    this.teardown = new TransferTeardown(logger, client, timer, this.pollIntervalMs);
    this.staged = new StagedFileResolver(
      logger,
      client,
      timer,
      config.stagingRoot,
      this.pollIntervalMs,
    );
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
      this.transferLedger.keyFor(acquisitionId, username, request.filename),
    );

    // Reconcile before enqueue (reactor-durability D3): live ledgered rows are evidence of a
    // prior attempt whose poller died with the process. If the source still holds those
    // transfers, re-attach — resume polling with fresh stall/queue budgets — rather than
    // download the candidate a second time; if the source lost them, fall through and re-enqueue.
    const prior = await this.transferLedger.liveTransferFilenames(acquisitionId, username, wanted);
    await this.transferLedger.recordCreated(ownedKeys);
    const isAttached = prior.size > 0 ? await this.reattach(username, wanted) : false;
    if (!isAttached) {
      this.logger.debug({ username, fileCount: requests.length }, 'enqueueing slskd download');
      const enqueue = await this.client.postRaw(downloadsPath(username), requests);
      if (enqueue.status >= 500 || [429, 401, 403].includes(enqueue.status)) {
        // A 5xx/429/401/403 is slskd itself faulting, throttling, or refusing auth — transient or
        // operational infrastructure, not this candidate's defeat. Throw so `ResultAsync.fromPromise`
        // maps it to a retryable InfraError (the reactor holds and retries), matching every other
        // GET/POST path in this adapter. Marking it a candidate failure would manufacture
        // AcquisitionExhausted from a transient slskd overload.
        throw new Error(`slskd responded ${enqueue.status} for POST ${downloadsPath(username)}`);
      }
      if (enqueue.status < 200 || enqueue.status >= 300) {
        // A 4xx (other than 401/403) means slskd answered and refused THIS candidate's enqueue
        // (typically an unreachable peer). That is a business failure for the retry ladder — reject
        // the candidate and advance to the next-best — never an InfraError, which would retry the
        // same dead peer forever (prod 2026-07-22). The write-ahead rows are released: nothing was
        // created at the source, so the sweep must not chase them.
        const reason = enqueueRejectionReason(enqueue.body);
        this.logger.warn(
          { username, status: enqueue.status, reason },
          'slskd rejected the enqueue; failing the candidate',
        );
        await this.transferLedger.release(ownedKeys);
        return { kind: 'failed', reason };
      }
    }

    const start = this.timer.now();
    let lastBytes = 0;
    let lastProgressAt = start;
    const captured = new Set<string>();
    for (;;) {
      const mine = await pollOwnedTransfers(this.client, username, wanted);
      await this.transferLedger.captureIds(acquisitionId, username, mine, captured);
      const status = aggregate(mine);
      onProgress(status.progress);

      if (status.succeeded) {
        this.logger.debug({ username }, 'slskd download completed');
        const files = await this.staged.stagedFiles(mine, candidate);
        await this.removeOwned(username, mine, ownedKeys);
        return { kind: 'completed', files };
      }
      if (status.hasFailure) {
        // One failed file dooms the candidate: cancel the rest (confirming their records are gone)
        // and report the original failure, not the cancellation it triggers. Files that succeeded
        // before the doom are reported so their staging is cleaned (design D2).
        this.logger.warn({ username, reason: status.failureReason }, 'slskd download failed');
        const files = await this.staged.completedStagedFiles(mine, candidate);
        await this.removeOwned(username, mine, ownedKeys);
        return { kind: 'failed', reason: status.failureReason, files };
      }

      const now = this.timer.now();
      if (status.progress.bytesTransferred > lastBytes) {
        lastBytes = status.progress.bytesTransferred;
        lastProgressAt = now;
      }
      if (status.allQueued && now - start >= policy.maxQueueWaitMs) {
        return this.abandon(username, mine, ownedKeys, 'QueueTimeout', candidate);
      }
      if (!status.allQueued && now - lastProgressAt >= policy.stallTimeoutMs) {
        return this.abandon(username, mine, ownedKeys, 'Stalled', candidate);
      }
      await this.timer.sleep(this.pollIntervalMs);
    }
  }

  /**
   * True only when the source still lists EVERY wanted transfer — polling resumes on them. A
   * partial survival must re-enqueue: resuming over a subset would settle `aggregate` on the
   * present files alone and surface an under-delivered candidate as a completed one.
   */
  private async reattach(username: string, wanted: ReadonlySet<string>): Promise<boolean> {
    const present = await pollOwnedTransfers(this.client, username, wanted);
    const covered = new Set(present.map((transfer) => transfer.filename));
    if (covered.size < wanted.size) {
      this.logger.warn(
        { username, present: covered.size, wanted: wanted.size },
        'ledgered transfers missing at the source; re-enqueueing',
      );
      return false;
    }
    this.logger.info({ username, count: present.length }, 're-attaching to live slskd transfers');
    return true;
  }

  /**
   * Cancel the acquisition's in-flight transfers at the source and remove their records (D:
   * cancellation). Called when a downloading acquisition is cancelled; idempotent, so a transfer
   * already settled or absent is tolerated and a redelivered abort is safe.
   */
  abort(
    acquisitionId: string,
    candidate: Candidate,
  ): ResultAsync<readonly DownloadedFile[], InfraError> {
    return ResultAsync.fromPromise(this.doAbort(acquisitionId, candidate), (cause) =>
      infraError('slskd.abort', String(cause), cause),
    );
  }

  private async doAbort(
    acquisitionId: string,
    candidate: Candidate,
  ): Promise<readonly DownloadedFile[]> {
    const { username } = candidate.identity;
    const filenames = candidate.files.map((file) =>
      remoteFilename(candidate.identity.path, file.name),
    );
    const wanted = new Set(filenames);
    const ownedKeys = filenames.map((filename) =>
      this.transferLedger.keyFor(acquisitionId, username, filename),
    );
    const mine = await pollOwnedTransfers(this.client, username, wanted);
    this.logger.debug({ username, count: mine.length }, 'aborting slskd download');
    // Resolve the already-completed subset before removal (the events log outlives the record), so
    // the caller can clean its staging even though the domain never saw a completion (design D2).
    const files = await this.staged.completedStagedFiles(mine, candidate);
    await this.removeOwned(username, mine, ownedKeys);
    return files;
  }

  /**
   * Report a policy abandonment: cancel + confirm-remove the owned transfers, then surface the
   * reason together with the subset the source already completed into staging, so its files are
   * cleaned via the domain (design D2).
   */
  private async abandon(
    username: string,
    mine: readonly OwnedTransfer[],
    ownedKeys: readonly SourceResourceKey[],
    reason: DownloadFailureReason,
    candidate: Candidate,
  ): Promise<DownloadResult> {
    this.logger.warn({ username, reason }, 'abandoning slskd download');
    const files = await this.staged.completedStagedFiles(mine, candidate);
    await this.removeOwned(username, mine, ownedKeys);
    return { kind: 'failed', reason, files };
  }

  /**
   * Tear down each owned transfer at the source, then mark a ledger row removed **only** once its
   * record is confirmed gone (slskd-abandon-full-teardown D1) — a row not confirmed within the
   * bound stays live so the startup sweep retires it.
   */
  private async removeOwned(
    username: string,
    mine: readonly OwnedTransfer[],
    ownedKeys: readonly SourceResourceKey[],
  ): Promise<void> {
    const wanted = new Set(ownedKeys.map((key) => filenameOfKey(key)));
    const stillPresent = await this.teardown.teardown(username, mine, wanted);
    await this.transferLedger.markRemoved(ownedKeys, stillPresent);
  }
}
