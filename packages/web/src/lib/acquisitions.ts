import type { AcquisitionStatusResponseDto } from '@music/downloader';
import type { BadgePhase } from './phase-label.js';

/**
 * Presentation vocabulary for acquisitions: pure mappings from facade DTOs to what the UI shows.
 * Shared by server loads and components; unit-tested in the node project.
 */

const TERMINAL: Record<string, BadgePhase | undefined> = {
  Fulfilled: 'fulfilled',
  Exhausted: 'failed',
  Cancelled: 'failed',
  MetadataFailed: 'failed',
  Conflicted: 'failed',
};

/** The badge tone for a status — terminal states resolve to fulfilled/failed, the rest pend. */
export function statusTone(status: AcquisitionStatusResponseDto['status']): BadgePhase {
  return TERMINAL[status] ?? 'pending';
}

export function isTerminal(status: AcquisitionStatusResponseDto['status']): boolean {
  return TERMINAL[status] !== undefined;
}

/** Anything not terminal can be asked to cancel; the decider converges if the ask is stale. */
export function isCancellable(status: AcquisitionStatusResponseDto['status']): boolean {
  return !isTerminal(status);
}

export function targetDescription(acquisition: AcquisitionStatusResponseDto): string {
  return acquisition.target
    ? `${acquisition.target.artist} — ${acquisition.target.title}`
    : '(resolving…)';
}

/** The terminal outcome line: where it landed, or why it failed (web-ui spec). */
export function outcomeSummary(acquisition: AcquisitionStatusResponseDto): string | undefined {
  if (acquisition.status === 'Fulfilled') return acquisition.location ?? 'Fulfilled';
  if (!isTerminal(acquisition.status)) return undefined;
  const failures = acquisition.history.flatMap((entry) => {
    if (entry.kind === 'download-failed') return [entry.reason];
    if (entry.kind === 'validation-failed') return entry.reasons;
    if (entry.kind === 'fulfillment-rejected') return entry.reasons;
    return [];
  });
  const detail = failures.length > 0 ? ` (${[...new Set(failures)].join(', ')})` : '';
  return `${acquisition.status}${detail}`;
}

export function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  const units = ['KiB', 'MiB', 'GiB'];
  let value = bytes;
  let unit = 'B';
  for (const next of units) {
    if (value < 1024) break;
    value /= 1024;
    unit = next;
  }
  return `${value.toFixed(1)} ${unit}`;
}
