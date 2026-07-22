import type { AcquisitionStatusResponseDto } from '@music/downloader';
import type { PendingReviewDto } from '@music/importer';
import { targetDescription } from './acquisitions.js';

/**
 * The attention queue's vocabulary (design D1): a web-owned view model composing everything that
 * waits on a human across modules. The unification lives at the UI edge on purpose — each facade
 * keeps its own read-model vocabulary, and the promotion trigger for a facade-level standard shape
 * is a second out-of-process consumer (design D2). Pure; unit-tested in the node project.
 */
export interface AttentionItem {
  readonly module: 'importer' | 'downloader';
  readonly kind: 'match-review' | 'edition-selection';
  readonly id: string;
  readonly title: string;
  /** ISO instant the item started waiting — optional: neither facade carries one today. */
  readonly waitingSince?: string;
  readonly href: string;
}

export function attentionItems(
  reviews: readonly PendingReviewDto[],
  acquisitions: readonly AcquisitionStatusResponseDto[],
): AttentionItem[] {
  return orderByLongestWaiting([
    ...reviews.map(reviewItem),
    ...acquisitions.filter((entry) => entry.status === 'AwaitingManualSelection').map(editionItem),
  ]);
}

function reviewItem(pending: PendingReviewDto): AttentionItem {
  return {
    module: 'importer',
    kind: 'match-review',
    id: pending.importId,
    // Sparse presentation fields degrade the item, never drop it (web-ui spec).
    title: pending.path === '' ? 'Import awaiting review' : pending.path,
    waitingSince: undefined,
    href: `/reviews/${pending.importId}`,
  };
}

function editionItem(acquisition: AcquisitionStatusResponseDto): AttentionItem {
  return {
    module: 'downloader',
    kind: 'edition-selection',
    id: acquisition.acquisitionId,
    title: targetDescription(acquisition),
    waitingSince: undefined,
    href: `/acquisitions/${acquisition.acquisitionId}`,
  };
}

/** Longest-waiting first; items without a date follow the dated ones in their given order. */
export function orderByLongestWaiting(items: readonly AttentionItem[]): AttentionItem[] {
  // ISO instants compare lexicographically; ￿ sorts undated items after any date. The sort
  // is stable, so facade order (itself oldest-first per module) survives among equals.
  const key = (entry: AttentionItem): string => entry.waitingSince ?? '￿';
  return [...items].sort((a, b) => (key(a) < key(b) ? -1 : key(a) > key(b) ? 1 : 0));
}

export function attentionKindLabel(kind: AttentionItem['kind']): string {
  switch (kind) {
    case 'match-review':
      return 'Match review';
    case 'edition-selection':
      return 'Edition selection';
  }
}

export function moduleLabel(module: AttentionItem['module']): string {
  switch (module) {
    case 'importer':
      return 'Importer';
    case 'downloader':
      return 'Downloader';
  }
}
