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

/**
 * Cancellable per the acquisition's own decided flag — the downloader's cancel guard, rendered, not
 * re-derived from the status enum. Absent (an older producer) degrades to not-cancellable, so the
 * cancel affordance is withheld rather than guessed from the phase name.
 */
export function isCancellable(acquisition: AcquisitionStatusResponseDto): boolean {
  return acquisition.cancellable === true;
}

/**
 * Terminal reads the decided flag — the cancel rule is "cancellable iff not terminal", so the BFF
 * reads the flag rather than deciding terminality from the status enum. Deliberately NOT defined as
 * `!isCancellable`: when the flag is absent BOTH degrade to false (no cancel affordance and no
 * terminal outcome shown) — the safe conservative read for an older producer. Restoring the
 * `isCancellable`/`isTerminal` inverse identity would flip that degrade and is a hazard, not a tidy-up.
 */
export function isTerminal(acquisition: AcquisitionStatusResponseDto): boolean {
  return acquisition.cancellable === false;
}

/**
 * True when the current attempt's transfer is live at the source: the history holds a
 * `download-started` entry not superseded by a later `selected` (a later selection is a new
 * attempt whose own start has not been recorded yet). The decided fact the downloading views
 * read instead of inferring liveness from a progress read's success
 * (nonblocking-download-observation).
 */
export function isTransferStarted(acquisition: AcquisitionStatusResponseDto): boolean {
  for (const entry of acquisition.history.toReversed()) {
    if (entry.kind === 'download-started') return true;
    if (entry.kind === 'selected') return false;
  }
  return false;
}

/**
 * The acquisition's display title, falling through resolved target → the request as given → a
 * neutral unknown-release label. A resolving placeholder appears only while resolution is
 * genuinely pending — never as the permanent title of a terminally failed acquisition (web-ui:
 * never-resolved acquisitions are titled by their request).
 */
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
  if (acquisition.requestedTarget?.kind === 'descriptor') {
    return `${acquisition.requestedTarget.artist} — ${acquisition.requestedTarget.title}`;
  }
  if (acquisition.status === 'Pending' || acquisition.status === 'Empty') return 'Resolving…';
  return 'Unknown release';
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
