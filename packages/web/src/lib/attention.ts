import type { AcquisitionStatusResponseDto } from '@music/downloader';
import type { PendingReviewDto, ReviewDto } from '@music/importer';
import { targetDescription } from './acquisitions.js';
import { kindLabel, reviewTitle } from './reviews.js';

/**
 * The attention queue's vocabulary (unified-attention-queue D1): a web-owned view model composing
 * everything that waits on a human across modules. The unification lives at the UI edge on
 * purpose — each facade keeps its own read-model vocabulary, and the promotion trigger for a
 * facade-level standard shape is a second out-of-process consumer (unified-attention-queue D2). Pure; unit-tested in the node project.
 *
 * The user sees one system: the visible row carries the title and the ask — the decision waiting
 * on them — never a module name. `module` stays machine-readable (a DOM attribute for skins and
 * tests), the same treatment the timeline gave its module tag.
 */
export interface AttentionItem {
  readonly module: 'importer' | 'downloader';
  /** The machine channel mirrors the ask: the review's own kind, or the edition pause. */
  readonly kind: ReviewDto['kind'] | 'edition-selection';
  readonly id: string;
  readonly title: string;
  /** The decision asked of the user, in plain action-oriented language (the chip's text). */
  readonly ask: string;
  /** ISO instant the item started waiting — optional: neither facade carries one today. */
  readonly waitingSince?: string;
  readonly href: string;
}

/** Kind determines module — every review kind is the importer's; the edition pause is the
 * downloader's. Totality over the union means a new review kind demands its owner here. */
const MODULE_OF = {
  'match-review': 'importer',
  'no-match': 'importer',
  'duplicate-review': 'importer',
  'remediation-review': 'importer',
  'edition-selection': 'downloader',
} as const satisfies Record<AttentionItem['kind'], AttentionItem['module']>;

export function attentionItems(
  reviews: readonly PendingReviewDto[],
  acquisitions: readonly AcquisitionStatusResponseDto[],
  /** Composed musical-intent titles keyed by import id (reviews-register-alignment D3). */
  reviewTitles?: ReadonlyMap<string, string>,
): AttentionItem[] {
  return orderByLongestWaiting([
    ...reviews.map((item) => reviewItem(item, reviewTitles?.get(item.importId))),
    // Membership in the edition-selection arm follows the downloader's decided awaiting-selection
    // flag, not the badge tone or the status enum: the pause is the downloader's determination, the
    // queue merely composes it. An older producer that omits the flag simply contributes no entry.
    ...acquisitions
      .filter((entry) => entry.awaitingSelection === true)
      .map((item) => editionItem(item)),
  ]);
}

function reviewItem(pending: PendingReviewDto, composedTitle: string | undefined): AttentionItem {
  return {
    // Structurally importer-owned: this item was composed from the importer's pending-review
    // read, so an unknown future kind keeps a factual module channel instead of breaking it.
    module:
      (MODULE_OF as Partial<Record<string, AttentionItem['module']>>)[pending.review.kind] ??
      'importer',
    kind: pending.review.kind,
    id: pending.importId,
    // Musical intent first, then the staged basename, then the neutral phrase — sparse
    // presentation fields degrade the item, never drop it (web-ui spec).
    title: reviewTitle(pending.path, composedTitle),
    ask: kindLabel(pending.review.kind),
    waitingSince: undefined,
    href: `/reviews/${pending.importId}`,
  };
}

function editionItem(acquisition: AcquisitionStatusResponseDto): AttentionItem {
  return {
    module: MODULE_OF['edition-selection'],
    kind: 'edition-selection',
    id: acquisition.acquisitionId,
    title: targetDescription(acquisition),
    ask: 'Choose an edition',
    waitingSince: undefined,
    href: `/acquisitions/${acquisition.acquisitionId}`,
  };
}

/** Longest-waiting first; items without a date follow the dated ones in their given order. */
export function orderByLongestWaiting(items: readonly AttentionItem[]): AttentionItem[] {
  // ISO instants in one uniform format (UTC `Z`, fixed precision) compare lexicographically —
  // keep producers uniform. '￿' (U+FFFF, the max BMP code unit) sorts undated items after
  // any date; the sort is stable, so the facades' given order survives among equals.
  const key = (entry: AttentionItem): string => entry.waitingSince ?? '\u{FFFF}';
  return items.toSorted((a, b) => (key(a) < key(b) ? -1 : key(a) > key(b) ? 1 : 0));
}
