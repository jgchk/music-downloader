import type { AcquisitionStatusResponseDto } from '@music/downloader';
import type { BadgePhase } from './phase-label.js';

/**
 * Presentation vocabulary for acquisitions: pure mappings from facade DTOs to what the UI shows.
 * Shared by server loads and components; unit-tested in the node project.
 */

/**
 * The badge tone for every status — exhaustive on purpose, so a status the downloader adds breaks
 * this build instead of silently inheriting a fallback tone (that is exactly how awaiting-selection
 * once hid as generic pending). Terminal states resolve to fulfilled/failed, a pause on the user
 * demands attention (web-ui spec: awaiting-selection presents as action-needed), the rest pend.
 */
const TONE = {
  Empty: 'pending',
  Pending: 'pending',
  AwaitingManualSelection: 'attention',
  Searching: 'pending',
  Selecting: 'pending',
  Downloading: 'pending',
  Validating: 'pending',
  Importing: 'pending',
  Fulfilled: 'fulfilled',
  Exhausted: 'failed',
  Cancelled: 'failed',
  MetadataFailed: 'failed',
  Conflicted: 'failed',
} as const satisfies Record<AcquisitionStatusResponseDto['status'], BadgePhase>;

export function statusTone(status: AcquisitionStatusResponseDto['status']): BadgePhase {
  return TONE[status];
}

export function isTerminal(status: AcquisitionStatusResponseDto['status']): boolean {
  return TONE[status] === 'fulfilled' || TONE[status] === 'failed';
}

/** Anything not terminal can be asked to cancel; the decider converges if the ask is stale. */
export function isCancellable(status: AcquisitionStatusResponseDto['status']): boolean {
  return !isTerminal(status);
}

export function targetDescription(acquisition: AcquisitionStatusResponseDto): string {
  if (acquisition.target) return `${acquisition.target.artist} — ${acquisition.target.title}`;
  if (acquisition.status === 'AwaitingManualSelection') {
    // The pause is the user's, so say what is awaited — never the in-progress placeholder. The
    // offered editions share the group's identity; borrow the first titled one as the headline.
    const title = acquisition.candidates?.find((candidate) => candidate.title !== undefined)?.title;
    return title === undefined
      ? 'Awaiting your edition choice'
      : `${title} — awaiting your edition choice`;
  }
  return '(resolving…)';
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

/** The offered editions, non-optionally, once the DTO is known to carry them. */
type EditionCandidates = NonNullable<AcquisitionStatusResponseDto['candidates']>;

/**
 * The awaiting-selection view, parsed at the UI edge (type-altitude: a discriminated view model, not
 * raw-status branching). The projection always carries `candidates` in this phase, so the two legal
 * cases — editions on offer vs. a stale/drifted reader that lost them — become distinct variants and
 * the `editions` variant carries NON-optional candidates. Every other status is `not-awaiting`.
 */
export type AcquisitionView =
  | { readonly kind: 'editions'; readonly candidates: EditionCandidates }
  | { readonly kind: 'no-editions' }
  | { readonly kind: 'not-awaiting' };

export function parseAcquisitionView(acquisition: AcquisitionStatusResponseDto): AcquisitionView {
  if (acquisition.status !== 'AwaitingManualSelection') return { kind: 'not-awaiting' };
  if (acquisition.candidates === undefined) return { kind: 'no-editions' };
  return { kind: 'editions', candidates: acquisition.candidates };
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
