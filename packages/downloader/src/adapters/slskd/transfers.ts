import type { DownloadFailureReason } from '../../domain/acquisition/events.js';
import type { DownloadProgress } from '../../application/ports/outbound-ports.js';
import type { SlskdTransfer, SlskdTransfersPayload } from './schemas.js';

/**
 * Pure interpretation of slskd's rich transfer reality into the small, source-agnostic facts the
 * domain sees (D10). slskd's per-file transfer state machine and byte counters are folded into one
 * candidate-level outcome plus an ephemeral progress snapshot; a source-specific failure is mapped
 * to the domain's small reason enum. Payloads arrive already validated against the contract schema
 * (D2), so these functions consume the inferred types directly.
 */

export type { SlskdTransfer };

/**
 * slskd's `GET …/downloads/{username}` returns a single user object whose transfers are grouped by
 * directory under `directories`; flatten those groups to a flat file list.
 */
export function flattenDownloads(payload: SlskdTransfersPayload): SlskdTransfer[] {
  return (payload.directories ?? []).flatMap((directory) => directory.files ?? []);
}

type TransferStatus = 'succeeded' | 'failed' | 'queued' | 'transferring';

function statusOf(state: string): TransferStatus {
  const normalized = state.toLowerCase();
  if (normalized.includes('completed')) {
    return normalized.includes('succeeded') ? 'succeeded' : 'failed';
  }
  if (normalized.includes('queued')) return 'queued';
  return 'transferring';
}

/**
 * Whether a transfer has reached slskd's terminal `Completed` flag — the guard slskd's synchronous
 * record removal is gated on (design D1). A terminal transfer can be removed (`?remove=true`); an
 * in-flight one must first be cancelled and left to transition before its record can be removed.
 */
export function isTransferComplete(transfer: SlskdTransfer): boolean {
  return (transfer.state ?? '').toLowerCase().includes('completed');
}

/** Whether a transfer completed *successfully* — its file is staged and can be resolved (D2). */
export function isTransferSucceeded(transfer: SlskdTransfer): boolean {
  return statusOf(transfer.state ?? '') === 'succeeded';
}

/** Translate a Soulseek failure into the domain's source-agnostic reason (D10). */
export function reasonFromTransfer(transfer: SlskdTransfer): DownloadFailureReason {
  const text = `${transfer.state ?? ''} ${transfer.exception ?? ''}`.toLowerCase();
  if (text.includes('cancel')) return 'Cancelled';
  if (text.includes('reject')) return 'FileUnavailable';
  if (text.includes('offline') || text.includes('unavailable')) return 'PeerUnavailable';
  if (text.includes('timed')) return 'Stalled';
  return 'TransferError';
}

/**
 * Translate an slskd enqueue *rejection* into the candidate-level failure reason (D10). An HTTP
 * rejection from slskd means slskd itself is up and answered — the candidate, not the
 * infrastructure, failed; a connection-flavored body names the peer. Transport-level failures
 * (slskd unreachable) never come here — they stay infrastructure faults and are retried.
 */
export function enqueueRejectionReason(body: string): DownloadFailureReason {
  const text = body.toLowerCase();
  if (text.includes('connect') || text.includes('offline') || text.includes('unavailable')) {
    return 'PeerUnavailable';
  }
  return 'TransferError';
}

export interface TransferAggregate {
  readonly progress: DownloadProgress;
  /** Every transfer has reached a terminal state (there is at least one transfer). */
  readonly settled: boolean;
  /** Every transfer succeeded. */
  readonly succeeded: boolean;
  /** Every transfer is still queued (nothing has started). */
  readonly allQueued: boolean;
  /** At least one transfer has failed terminally (dooms the candidate before the rest settle). */
  readonly hasFailure: boolean;
  /** The reason to report if the candidate is failing (the first failed transfer's reason). */
  readonly failureReason: DownloadFailureReason;
}

/** Fold a candidate's per-file transfers into one outcome-shaped aggregate. */
export function aggregate(transfers: readonly SlskdTransfer[]): TransferAggregate {
  const statuses = transfers.map((transfer) => statusOf(transfer.state ?? ''));
  const bytesTransferred = transfers.reduce((sum, t) => sum + (t.bytesTransferred ?? 0), 0);
  const bytesTotal = transfers.reduce((sum, t) => sum + (t.size ?? 0), 0);
  const queuePosition = transfers
    .map((transfer) => transfer.placeInQueue)
    .find((place) => place !== undefined);
  const failed = transfers.find((transfer) => statusOf(transfer.state ?? '') === 'failed');

  return {
    progress: {
      percent: bytesTotal === 0 ? 0 : (bytesTransferred / bytesTotal) * 100,
      bytesTransferred,
      bytesTotal,
      queuePosition,
    },
    settled: statuses.length > 0 && statuses.every((s) => s === 'succeeded' || s === 'failed'),
    succeeded: statuses.length > 0 && statuses.every((s) => s === 'succeeded'),
    allQueued: statuses.length > 0 && statuses.every((s) => s === 'queued'),
    hasFailure: failed !== undefined,
    failureReason: failed === undefined ? 'TransferError' : reasonFromTransfer(failed),
  };
}
