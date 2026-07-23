import { describe, expect, it } from 'vitest';
import type { AcquisitionStatusResponseDto } from '@music/downloader';
import type { PendingReviewDto } from '@music/importer';
import {
  attentionItems,
  attentionKindLabel,
  moduleLabel,
  orderByLongestWaiting,
  type AttentionItem,
} from './attention.js';

function review(over: Partial<PendingReviewDto>): PendingReviewDto {
  return {
    importId: 'imp-1',
    path: '/intake/album',
    review: { kind: 'no-match' },
    ...over,
  };
}

function acquisition(over: Partial<AcquisitionStatusResponseDto>): AcquisitionStatusResponseDto {
  return {
    acquisitionId: 'acq-1',
    status: 'AwaitingManualSelection',
    attempts: 0,
    rejectedCount: 0,
    history: [],
    ...over,
  };
}

function item(over: Partial<AttentionItem>): AttentionItem {
  return {
    module: 'importer',
    kind: 'match-review',
    id: 'x',
    title: 't',
    href: '/reviews/x',
    ...over,
  };
}

describe('attentionItems', () => {
  it('maps a pending review to an importer match-review item linking to its review', () => {
    expect(attentionItems([review({})], [])).toEqual([
      {
        module: 'importer',
        kind: 'match-review',
        id: 'imp-1',
        title: '/intake/album',
        waitingSince: undefined,
        href: '/reviews/imp-1',
      },
    ]);
  });

  it('maps an awaiting-selection acquisition to a downloader edition-selection item', () => {
    const awaiting = acquisition({
      candidates: [{ releaseMbid: 'r1', title: 'OK Computer', trackCount: 12 }],
    });
    expect(attentionItems([], [awaiting])).toEqual([
      {
        module: 'downloader',
        kind: 'edition-selection',
        id: 'acq-1',
        title: 'OK Computer — awaiting your edition choice',
        waitingSince: undefined,
        href: '/acquisitions/acq-1',
      },
    ]);
  });

  it('excludes every acquisition status that is not awaiting manual selection', () => {
    const statuses = [
      'Pending',
      'Searching',
      'Downloading',
      'Fulfilled',
      'Exhausted',
      'Cancelled',
      'MetadataFailed',
      'Conflicted',
    ] as const;
    const acquisitions = statuses.map((status, index) =>
      acquisition({ acquisitionId: `acq-${index}`, status }),
    );
    expect(attentionItems([], acquisitions)).toEqual([]);
  });

  it('composes both modules into one queue, in facade order while nothing carries a date', () => {
    const items = attentionItems(
      [review({ importId: 'imp-1' }), review({ importId: 'imp-2' })],
      [acquisition({})],
    );
    expect(items.map((entry) => entry.id)).toEqual(['imp-1', 'imp-2', 'acq-1']);
  });

  it('never drops an item for sparse presentation fields — an empty path gets a fallback title', () => {
    const items = attentionItems([review({ path: '' })], [acquisition({})]);
    expect(items).toHaveLength(2);
    expect(items[0]?.title).toBe('Import awaiting review');
  });
});

describe('orderByLongestWaiting', () => {
  it('puts dated items oldest-first ahead of undated ones, keeping undated order stable', () => {
    const undatedA = item({ id: 'a' });
    const undatedB = item({ id: 'b' });
    const older = item({ id: 'old', waitingSince: '2026-07-01T00:00:00Z' });
    const newer = item({ id: 'new', waitingSince: '2026-07-20T00:00:00Z' });
    expect(
      orderByLongestWaiting([undatedA, newer, undatedB, older]).map((entry) => entry.id),
    ).toEqual(['old', 'new', 'a', 'b']);
  });

  it('leaves equally-dated items in their given order', () => {
    const first = item({ id: 'first', waitingSince: '2026-07-01T00:00:00Z' });
    const second = item({ id: 'second', waitingSince: '2026-07-01T00:00:00Z' });
    expect(orderByLongestWaiting([first, second]).map((entry) => entry.id)).toEqual([
      'first',
      'second',
    ]);
  });
});

describe('labels', () => {
  it.each([
    ['match-review', 'Match review'],
    ['edition-selection', 'Edition selection'],
  ] as const)('labels kind %s as %s', (kind, label) => {
    expect(attentionKindLabel(kind)).toBe(label);
  });

  it.each([
    ['importer', 'Importer'],
    ['downloader', 'Downloader'],
  ] as const)('labels module %s as %s', (module, label) => {
    expect(moduleLabel(module)).toBe(label);
  });
});
