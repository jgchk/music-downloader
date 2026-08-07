import { ResultAsync } from 'neverthrow';
import type { Candidate } from '../../domain/candidate/candidate.js';
import { candidateKey } from '../../domain/candidate/candidate.js';
import type { DownloadPolicy } from '../../domain/policy/policies.js';
import type { DownloadFailureReason, DownloadedFile } from '../../domain/acquisition/events.js';
import { infraError } from '../../application/ports/errors.js';
import type { InfraError } from '../../application/ports/errors.js';
import type { OperationScope } from '../../application/correlation/context.js';
import type {
  DownloadObserverPort,
  DownloadPort,
  DownloadResult,
  DownloadStart,
} from '../../application/ports/outbound-ports.js';
import type {
  ResourceLedgerStore,
  SourceResourceKey,
} from '../../application/ports/resource-ledger-port.js';
import type { Logger } from '../../application/logging/logger.js';
import { downloadsPath } from './client.js';
import type { SlskdConfig, SlskdClient } from './client.js';
import { remoteFilename } from './mapping.js';
import { pollOwnedTransfers } from './poll.js';
import { StagedFileResolver } from './staged-files.js';
import { TransferLedger, filenameOfKey } from './transfer-ledger.js';
import { TransferTeardown } from './teardown.js';
import { realTimer } from './timer.js';
import type { Timer } from './timer.js';
import { aggregate, enqueueRejectionReason, recogniseRejection } from './transfers.js';
import type { OwnedTransfer } from './transfers.js';

/**
 * The slskd `DownloadPort` adapter — the download supervisor (nonblocking-download-observation
 * D1). `start` reconciles/re-attaches against the ownership ledger, enqueues when the source
 * holds nothing, registers an in-memory watch, and returns promptly; the watch then observes the
 * transfers on its own cadence — never inside a reactor dispatch — and reports one candidate-level
 * outcome through the {@link DownloadObserverPort} when it settles. Progress is surfaced live via
 * the observer (never as events — D4). The supervisor owns the *detection* of stalls and hopeless
 * queues against the caller-supplied policy (the policy stays source-agnostic), and dooms the
 * whole candidate the moment any file fails rather than downloading the rest of a release it will
 * reject.
 *
 * The watch is deliberately storeless and level-triggered: slskd plus the ownership ledger hold
 * the durable transfer truth, so a watch lost with the process is rebuilt by re-dispatching
 * `start` (the reactor's startup re-drive), which re-attaches to live transfers — or finds them
 * settled and re-emits the outcome immediately. Tick errors (a lagging events log, a malformed
 * poll body) are logged and retried on the next tick — self-healing, never a lost download.
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
/** Persistent-failure loops promote every Nth warn to an error — a wedge is loud, a blip is not. */
export const ESCALATE_EVERY = 10;

export interface SlskdDownloadConfig extends SlskdConfig {
  /** Root under which each candidate's files are staged (shared with the filesystem library). */
  readonly stagingRoot: string;
}

/** One live watch: its abort latch and a deferred that resolves when the entry is released. */
interface Watch {
  aborted: boolean;
  /** Pending from reservation until {@link SlskdDownload.releaseWatch} — truthful from birth. */
  readonly done: Promise<void>;
  readonly finish: () => void;
  /**
   * The dispatching operation, PINNED at watch creation. The watch loop, its teardown, and the
   * outcome delivery all run after an async gap the dispatch itself does not survive — the exact
   * hop that breaks a correlation chain in every system that forgets it. The supervisor never
   * reads a field of this: it logs through `scope.logger` and hands `scope.context` back to the
   * observer verbatim.
   */
  readonly scope: OperationScope;
}

export class SlskdDownload implements DownloadPort {
  private readonly client: SlskdClient;
  private readonly pollIntervalMs: number;
  private readonly transferLedger: TransferLedger;
  private readonly teardown: TransferTeardown;
  private readonly staged: StagedFileResolver;
  private readonly watches = new Map<string, Watch>();

  constructor(
    /**
     * The root logger, used ONLY to construct the long-lived collaborators below. The supervisor
     * itself logs exclusively through `watch.scope.logger`, so its own lines join their story;
     * the collaborators are built once and outlive any single operation, so their lines carry
     * `acquisitionId` and are findable by aggregate but not joinable by story. That is a
     * deliberate boundary, recorded in design.md, not an oversight.
     */
    collaboratorLogger: Logger,
    ledger: ResourceLedgerStore,
    config: SlskdDownloadConfig,
    private readonly observer: DownloadObserverPort,
    client: SlskdClient,
    private readonly timer: Timer = realTimer,
  ) {
    this.client = client;
    this.pollIntervalMs = config.pollIntervalMs ?? DEFAULT_POLL_INTERVAL_MS;
    this.transferLedger = new TransferLedger(collaboratorLogger, ledger);
    this.teardown = new TransferTeardown(collaboratorLogger, client, timer, this.pollIntervalMs);
    this.staged = new StagedFileResolver(
      collaboratorLogger,
      client,
      timer,
      config.stagingRoot,
      this.pollIntervalMs,
    );
  }

  start(
    acquisitionId: string,
    candidate: Candidate,
    policy: DownloadPolicy,
    scope: OperationScope,
  ): ResultAsync<DownloadStart, InfraError> {
    return ResultAsync.fromPromise(this.doStart(acquisitionId, candidate, policy, scope), (cause) =>
      infraError('slskd.download', String(cause), cause),
    );
  }

  /** Every watch has run to completion — the test seam. */
  async settled(): Promise<void> {
    while (this.watches.size > 0) {
      await Promise.all(this.watches.values().map((watch) => watch.done));
    }
  }

  private async doStart(
    acquisitionId: string,
    candidate: Candidate,
    policy: DownloadPolicy,
    scope: OperationScope,
  ): Promise<DownloadStart> {
    const key = this.watchKey(acquisitionId, candidate);
    const existing = this.watches.get(key);
    // Level-triggered ensure: an already-live watch is the answer. An aborted watch still winding
    // down is NOT — fall through and register afresh (its guarded cleanup cannot touch ours).
    if (existing !== undefined && !existing.aborted) return { kind: 'started' };

    // Reserve the key before the first await: the one-watch-per-key invariant is enforced HERE,
    // not by trusting every caller to serialize (the reactor's mutex does today, but the adapter
    // cannot see that). A concurrent ensure during the reconcile/enqueue below answers `started`.
    // A reservation that then fails (a refused enqueue, a thrown reconcile) is released — and the
    // level-triggered re-dispatch is what heals a concurrent ensure that trusted it.
    const { promise, resolve } = Promise.withResolvers<void>();
    const watch: Watch = { aborted: false, done: promise, finish: resolve, scope };
    this.watches.set(key, watch);

    try {
      return await this.reconcileAndEnqueue(watch, key, acquisitionId, candidate, policy);
    } catch (error) {
      this.releaseWatch(key, watch);
      this.retireIfLastWatch(acquisitionId);
      throw error;
    }
  }

  /**
   * The per-attempt transfer identities, derived from the candidate in ONE place so the
   * requests/wanted/ownedKeys trio can never disagree with it across start and abort.
   */
  private transferPlan(
    acquisitionId: string,
    candidate: Candidate,
  ): {
    username: string;
    requests: readonly { readonly filename: string; readonly size: number }[];
    wanted: ReadonlySet<string>;
    ownedKeys: readonly SourceResourceKey[];
  } {
    const { username } = candidate.identity;
    const requests = candidate.files.map((file) => ({
      filename: remoteFilename(candidate.identity.path, file.name),
      size: file.sizeBytes,
    }));
    const wanted = new Set(requests.map((request) => request.filename));
    const ownedKeys = requests.map((request) =>
      this.transferLedger.keyFor(acquisitionId, username, request.filename),
    );
    return { username, requests, wanted, ownedKeys };
  }

  /** The reserve-then-enqueue body of {@link doStart}; the caller owns releasing on a throw. */
  private async reconcileAndEnqueue(
    watch: Watch,
    key: string,
    acquisitionId: string,
    candidate: Candidate,
    policy: DownloadPolicy,
  ): Promise<DownloadStart> {
    const { username, requests, wanted, ownedKeys } = this.transferPlan(acquisitionId, candidate);
    // Reconcile before enqueue (reactor-durability D3): live ledgered rows are evidence of a
    // prior attempt whose watch died with the process. If the source still holds those
    // transfers, re-attach — resume watching with fresh stall/queue budgets — rather than
    // download the candidate a second time; if the source lost them, fall through and re-enqueue.
    const prior = await this.transferLedger.liveTransferFilenames(acquisitionId, username, wanted);
    await this.transferLedger.recordCreated(ownedKeys);
    const isAttached = prior.size > 0 ? await this.reattach(username, wanted, watch.scope) : false;
    if (!isAttached) {
      watch.scope.logger.debug(
        { username, fileCount: requests.length },
        'enqueueing slskd download',
      );
      const enqueue = await this.client.postRaw(downloadsPath(username), requests);
      if (enqueue.status >= 500 || [429, 401, 403].includes(enqueue.status)) {
        // Treated as slskd itself faulting, throttling, or refusing auth — transient or operational
        // infrastructure, not this candidate's defeat. Throw so `ResultAsync.fromPromise` maps it to
        // a retryable InfraError (the reactor parks and retries the short start effect), matching
        // every other GET/POST path in this adapter.
        //
        // KNOWN INCOMPLETE for 5xx, and deliberately not fixed here (change: slskd-contract-truth).
        // The recording lab witnessed slskd 0.22.5 answering *every* enqueue failure with a 500 — an
        // offline peer, a file the peer does not share, a peer that never answers — so those take
        // THIS branch, not the candidate-failure branch below, and the "never an InfraError" promise
        // written there does not hold for them. The consequence is real: a dead peer parks the
        // acquisition for the whole retry budget instead of failing the candidate and advancing the
        // ladder. Separating "slskd is unwell" from "slskd says this peer is bad" means reading the
        // body on a 5xx, which promotes text classification into the retry decision — its own
        // design question, proposed separately. The evidence is pinned by the contract tier's
        // "answers every enqueue failure with a 500" test.
        //
        // Until then, log what slskd's body classifies to, so an operator staring at a parked
        // acquisition can tell the two apart. The reason is derived and PII-free; the body itself is
        // never logged, because it embeds the peer's chosen username verbatim.
        // Only a 5xx carries a peer-rejection body worth reading; a 401/403/429 is slskd's own
        // health or auth speaking, and classifying that text would invite an operator to read a
        // peer verdict into it. `recogniseRejection` reports a miss distinctly, because
        // `TransferError` is both a real classification and the catch-all — "unrecognised" is what
        // an overloaded slskd looks like, and that is the distinction this field exists to make.
        watch.scope.logger.warn(
          {
            username,
            status: enqueue.status,
            ...(enqueue.status >= 500 && {
              wouldBe: recogniseRejection(enqueue.body, username) ?? 'unrecognised',
            }),
          },
          'slskd refused the enqueue; retrying as infrastructure',
        );
        // The peer username stays out of the thrown message: this string reaches dead-letter
        // payloads, where pino's structured redaction cannot follow interpolated text. The
        // structured fields above are scrubbed by the composed logger's redaction paths, so the
        // peer is deliberately recoverable nowhere downstream.
        throw new Error(`slskd responded ${enqueue.status} for the download enqueue POST`);
      }
      if (enqueue.status < 200 || enqueue.status >= 300) {
        // A 4xx (other than 401/403) means slskd answered and refused THIS candidate's enqueue.
        // That is a business failure for the retry ladder — reject the candidate and advance to the
        // next-best — rather than an InfraError, which would retry the same dead peer (prod
        // 2026-07-22). The write-ahead rows are released: nothing was created at the source, so the
        // sweep must not chase them.
        //
        // Note the reach of this branch is narrower than it looks: the pinned slskd answers peer
        // refusals with a 500, so those are absorbed by the branch above. See its comment.
        const reason = enqueueRejectionReason(enqueue.body, username);
        watch.scope.logger.warn(
          { username, status: enqueue.status, reason },
          'slskd rejected the enqueue; failing the candidate',
        );
        await this.transferLedger.release(ownedKeys);
        this.releaseWatch(key, watch);
        this.retireIfLastWatch(acquisitionId);
        return { kind: 'rejected', reason };
      }
    }

    void this.runWatch(watch, key, acquisitionId, candidate, policy, wanted, ownedKeys);
    return { kind: 'started' };
  }

  /** Drop a reservation/watch entry — only our own (a successor may have replaced it). */
  private releaseWatch(key: string, watch: Watch): void {
    if (this.watches.get(key) === watch) this.watches.delete(key);
    watch.finish();
  }

  /**
   * Retire the acquisition's live progress once its LAST watch (or failed reservation) is gone —
   * every release path funnels here, so a frozen progress bar cannot outlive the watches that
   * fed it, while a genuine sibling (a successor candidate's watch) keeps the bar alive.
   */
  private retireIfLastWatch(acquisitionId: string): void {
    if (!this.hasWatchFor(acquisitionId)) this.observer.finished(acquisitionId);
  }

  /** True while any watch (any candidate) for the acquisition is still registered. */
  private hasWatchFor(acquisitionId: string): boolean {
    const prefix = `${acquisitionId}|`;
    for (const key of this.watches.keys()) if (key.startsWith(prefix)) return true;
    return false;
  }

  /**
   * Shutdown latch: every watch exits at its next wake without delivering, so nothing keeps
   * polling the source or retrying deliveries against torn-down infrastructure. Deliberately not
   * a drain — the startup re-drive re-drives an unfinished candidate (re-attaching where the
   * source still holds its transfers, repeating the download where teardown already removed
   * them), so a latched-away outcome costs at most a repeat transfer, never the acquisition.
   */
  stop(): void {
    for (const watch of this.watches.values()) watch.aborted = true;
  }

  /**
   * The watch loop — the observation the reactor used to block on, now on the supervisor's own
   * cadence. Each tick samples the source, surfaces progress, judges the caller's stall/queue
   * budgets, and either settles (pinning the verdict BEFORE any source teardown, then delivering
   * the single outcome fact) or sleeps. A tick that throws is logged and retried next tick — with
   * escalation once failures persist; an aborted watch exits without an outcome — the abort path
   * owns that settlement. The whole loop is exception-contained: `watch.done` never rejects.
   */
  private async runWatch(
    watch: Watch,
    key: string,
    acquisitionId: string,
    candidate: Candidate,
    policy: DownloadPolicy,
    wanted: ReadonlySet<string>,
    ownedKeys: readonly SourceResourceKey[],
  ): Promise<void> {
    const { username } = candidate.identity;
    const start = this.timer.now();
    let lastBytes = 0;
    let lastProgressAt = start;
    let consecutiveTickFailures = 0;
    const captured = new Set<string>();
    try {
      for (;;) {
        if (watch.aborted) return;
        let result: DownloadResult | undefined;
        try {
          const mine = await pollOwnedTransfers(this.client, username, wanted);
          await this.transferLedger.captureIds(acquisitionId, username, mine, captured);
          const status = aggregate(mine, username);
          this.observer.progress(acquisitionId, status.progress);

          if (status.succeeded) {
            watch.scope.logger.debug({ username }, 'slskd download completed');
            // Resolve the staged files BEFORE any teardown (a throw here retries against the
            // still-present transfers), then pin the verdict — teardown can no longer lose it.
            const files = await this.staged.stagedFiles(mine, candidate);
            result = { kind: 'completed', files };
            await this.teardownOwned(acquisitionId, username, mine, ownedKeys, watch.scope);
          } else if (status.hasFailure) {
            // One failed file dooms the candidate: cancel the rest (confirming their records are
            // gone) and report the original failure, not the cancellation it triggers. Files that
            // succeeded before the doom are reported so their staging is cleaned (design D2).
            watch.scope.logger.warn(
              { username, reason: status.failureReason },
              'slskd download failed',
            );
            const files = await this.staged.completedStagedFiles(mine, candidate);
            result = { kind: 'failed', reason: status.failureReason, files };
            await this.teardownOwned(acquisitionId, username, mine, ownedKeys, watch.scope);
          } else {
            const now = this.timer.now();
            if (status.progress.bytesTransferred > lastBytes) {
              lastBytes = status.progress.bytesTransferred;
              lastProgressAt = now;
            }
            if (status.allQueued && now - start >= policy.maxQueueWaitMs) {
              result = await this.abandon(
                acquisitionId,
                username,
                mine,
                ownedKeys,
                'QueueTimeout',
                candidate,
                watch.scope,
              );
            } else if (!status.allQueued && now - lastProgressAt >= policy.stallTimeoutMs) {
              result = await this.abandon(
                acquisitionId,
                username,
                mine,
                ownedKeys,
                'Stalled',
                candidate,
                watch.scope,
              );
            }
          }
          consecutiveTickFailures = 0;
        } catch (error) {
          // `aborted` is latched true by stop() while this
          // tick is in flight. TypeScript does not invalidate property narrowing across an await, so it reads
          // the latch as constant — deleting this condition would break shutdown handling.
          // eslint-disable-next-line @typescript-eslint/no-unnecessary-condition
          if (watch.aborted) {
            // A latched watch's in-flight tick failing (e.g. against torn-down infrastructure at
            // shutdown) is the expected wind-down, not a retry — say so and exit.
            watch.scope.logger.debug(
              { acquisitionId, username },
              'watch aborted mid-tick; exiting',
            );
            return;
          }
          // Self-healing (level-triggered): a failed observation delays the settle, it never
          // loses it — the next tick re-samples current state. Escalate once failures persist,
          // so a wedged watch (schema drift, misconfigured staging) is distinguishable from a
          // one-tick events-log lag in the logs.
          consecutiveTickFailures += 1;
          const log =
            consecutiveTickFailures % ESCALATE_EVERY === 0
              ? watch.scope.logger.error.bind(watch.scope.logger)
              : watch.scope.logger.warn.bind(watch.scope.logger);
          log(
            {
              acquisitionId,
              username,
              candidatePath: candidate.identity.path,
              consecutiveTickFailures,
              err: error,
            },
            'download watch tick failed; retrying on the next tick',
          );
        }
        if (result !== undefined) {
          await this.deliver(watch, acquisitionId, candidate, result);
          return;
        }
        await this.timer.sleep(this.pollIntervalMs);
      }
    } catch (error) {
      // Nothing may escape the floating loop: an unexpected throw (a bug, not a modeled fault)
      // is logged with its context and the watch dies. The startup re-drive re-drives the
      // candidate — re-attaching where the source still holds the transfers, otherwise repeating
      // the download — so the acquisition is never lost, at the cost of a possible repeat.
      watch.scope.logger.error(
        { acquisitionId, username, err: error },
        'download watch failed unexpectedly; a restart re-drive resumes the candidate',
      );
    } finally {
      // The cleanup itself is contained too: `watch.done` must never reject, and a throwing
      // observer must not leave the registry entry live.
      try {
        this.releaseWatch(key, watch);
        this.retireIfLastWatch(acquisitionId);
      } catch (error) {
        watch.scope.logger.error({ acquisitionId, err: error }, 'watch cleanup failed');
      }
    }
  }

  /**
   * Deliver the settled outcome, retrying on the watch cadence until it lands — once per watch
   * (system-wide, delivery is at-least-once: a boot re-emit may repeat it, and the decision
   * path absorbs the duplicate — an empty decision or a recorded-and-skipped rejection).
   * Persistent failures escalate so an undeliverable outcome is loud, not a quiet warn loop.
   */
  private async deliver(
    watch: Watch,
    acquisitionId: string,
    candidate: Candidate,
    result: DownloadResult,
  ): Promise<void> {
    for (let attempt = 1; ; attempt += 1) {
      if (watch.aborted) return;
      const delivered = await this.observer.outcome(
        acquisitionId,
        candidate.identity,
        result,
        watch.scope.context,
      );
      if (delivered.isOk()) return;
      const log =
        attempt % ESCALATE_EVERY === 0
          ? watch.scope.logger.error.bind(watch.scope.logger)
          : watch.scope.logger.warn.bind(watch.scope.logger);
      log(
        {
          acquisitionId,
          username: candidate.identity.username,
          candidatePath: candidate.identity.path,
          outcome: result.kind,
          attempt,
          err: delivered.error,
        },
        'download outcome delivery failed; retrying on the watch cadence',
      );
      await this.timer.sleep(this.pollIntervalMs);
    }
  }

  private watchKey(acquisitionId: string, candidate: Candidate): string {
    return `${acquisitionId}|${candidateKey(candidate.identity)}`;
  }

  /**
   * True only when the source still lists EVERY wanted transfer — the watch resumes on them. A
   * partial survival must re-enqueue: resuming over a subset would settle `aggregate` on the
   * present files alone and surface an under-delivered candidate as a completed one.
   */
  private async reattach(
    username: string,
    wanted: ReadonlySet<string>,
    scope: OperationScope,
  ): Promise<boolean> {
    const present = await pollOwnedTransfers(this.client, username, wanted);
    const covered = new Set(present.map((transfer) => transfer.filename));
    if (covered.size < wanted.size) {
      scope.logger.warn(
        { username, present: covered.size, wanted: wanted.size },
        'ledgered transfers missing at the source; re-enqueueing',
      );
      return false;
    }
    scope.logger.info({ username, count: present.length }, 're-attaching to live slskd transfers');
    return true;
  }

  /**
   * Cancel the acquisition's in-flight transfers at the source and remove their records (D:
   * cancellation). Ends the candidate's watch first — promptly, without waiting for the transfer
   * to settle on its own — so no outcome is emitted for a candidate the caller abandoned; the
   * abort's own settlement (fed back by the interpreter) owns the staging cleanup. Idempotent, so
   * a transfer already settled or absent is tolerated and a redelivered abort is safe.
   */
  abort(
    acquisitionId: string,
    candidate: Candidate,
    scope: OperationScope,
  ): ResultAsync<readonly DownloadedFile[], InfraError> {
    const watch = this.watches.get(this.watchKey(acquisitionId, candidate));
    if (watch !== undefined) watch.aborted = true;
    return ResultAsync.fromPromise(this.doAbort(acquisitionId, candidate, scope), (cause) =>
      infraError('slskd.abort', String(cause), cause),
    );
  }

  private async doAbort(
    acquisitionId: string,
    candidate: Candidate,
    scope: OperationScope,
  ): Promise<readonly DownloadedFile[]> {
    const { username, wanted, ownedKeys } = this.transferPlan(acquisitionId, candidate);
    const mine = await pollOwnedTransfers(this.client, username, wanted);
    scope.logger.debug({ username, count: mine.length }, 'aborting slskd download');
    // Resolve the already-completed subset before removal (the events log outlives the record), so
    // the caller can clean its staging even though the domain never saw a completion (design D2).
    const files = await this.staged.completedStagedFiles(mine, candidate);
    await this.removeOwned(username, mine, ownedKeys);
    return files;
  }

  /**
   * Report a policy abandonment: resolve the already-completed subset and pin the verdict, then
   * cancel + confirm-remove the owned transfers (guarded — the verdict survives a teardown
   * fault), so the reason and the staged subset reach the domain for cleanup (design D2).
   */
  private async abandon(
    acquisitionId: string,
    username: string,
    mine: readonly OwnedTransfer[],
    ownedKeys: readonly SourceResourceKey[],
    reason: DownloadFailureReason,
    candidate: Candidate,
    scope: OperationScope,
  ): Promise<DownloadResult> {
    scope.logger.warn({ username, reason }, 'abandoning slskd download');
    const files = await this.staged.completedStagedFiles(mine, candidate);
    const result: DownloadResult = { kind: 'failed', reason, files };
    await this.teardownOwned(acquisitionId, username, mine, ownedKeys, scope);
    return result;
  }

  /**
   * Teardown guarded so a fault can never mutate a settled verdict: once the source's records
   * are being removed, a retried tick would mis-read the emptied listing as a stall — so the
   * verdict is pinned first and a teardown fault is logged and left to the startup sweep (the
   * documented backstop for unconfirmed removals), never rethrown into the tick.
   */
  private async teardownOwned(
    acquisitionId: string,
    username: string,
    mine: readonly OwnedTransfer[],
    ownedKeys: readonly SourceResourceKey[],
    scope: OperationScope,
  ): Promise<void> {
    try {
      await this.removeOwned(username, mine, ownedKeys);
    } catch (error) {
      scope.logger.warn(
        { acquisitionId, username, err: error },
        'transfer teardown failed after the outcome settled; ledger rows stay live for the sweep',
      );
    }
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
