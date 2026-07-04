import type { DownloadFailureReason } from '../../domain/acquisition/events.js';
import type { DownloadProgress } from '../../application/ports/outbound-ports.js';

/**
 * Pure interpretation of slskd's rich transfer reality into the small, source-agnostic facts the
 * domain sees (D10). slskd's per-file transfer state machine and byte counters are folded into one
 * candidate-level outcome plus an ephemeral progress snapshot; a source-specific failure is mapped
 * to the domain's small reason enum.
 */

export interface SlskdTransfer {
  readonly id?: string;
  readonly filename?: string;
  readonly state?: string;
  readonly size?: number;
  readonly bytesTransferred?: number;
  readonly placeInQueue?: number;
  readonly exception?: string;
}

/** slskd's `GET …/downloads/{username}` groups transfers by directory; flatten to a file list. */
export function flattenDownloads(json: unknown): SlskdTransfer[] {
  const directories = (json as readonly { files?: readonly SlskdTransfer[] }[] | undefined) ?? [];
  return directories.flatMap((directory) => directory.files ?? []);
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

/** Translate a Soulseek failure into the domain's source-agnostic reason (D10). */
export function reasonFromTransfer(transfer: SlskdTransfer): DownloadFailureReason {
  const text = `${transfer.state ?? ''} ${transfer.exception ?? ''}`.toLowerCase();
  if (text.includes('cancel')) return 'Cancelled';
  if (text.includes('reject')) return 'FileUnavailable';
  if (text.includes('offline') || text.includes('unavailable')) return 'PeerUnavailable';
  if (text.includes('timed')) return 'Stalled';
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
    failureReason: failed === undefined ? 'TransferError' : reasonFromTransfer(failed),
  };
}
