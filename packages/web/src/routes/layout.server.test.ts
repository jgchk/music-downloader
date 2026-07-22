import { describe, expect, it } from 'vitest';
import type { DownloaderFacade } from '@music/downloader';
import type { ImporterFacade } from '@music/importer';
import { load } from './+layout.server.js';

function locals(over: {
  listPendingReviews?: () => unknown;
  listAcquisitions?: () => unknown;
}): App.Locals {
  return {
    facades: {
      importer: {
        listPendingReviews: over.listPendingReviews ?? (() => ({ reviews: [] })),
      } as unknown as ImporterFacade,
      downloader: {
        listAcquisitions: over.listAcquisitions ?? (() => ({ acquisitions: [] })),
      } as unknown as DownloaderFacade,
    },
  };
}

const pendingReview = { importId: 'imp-1', path: '/intake/a', review: { kind: 'no-match' } };
const awaiting = {
  acquisitionId: 'acq-1',
  status: 'AwaitingManualSelection',
  attempts: 0,
  rejectedCount: 0,
  history: [],
};
const searching = { ...awaiting, acquisitionId: 'acq-2', status: 'Searching' };

describe('root layout load', () => {
  it('counts the attention items across both modules', () => {
    const result = load({
      locals: locals({
        listPendingReviews: () => ({ reviews: [pendingReview] }),
        listAcquisitions: () => ({ acquisitions: [awaiting, searching] }),
      }),
    } as never);
    expect(result).toEqual({ attentionCount: 2 });
  });

  it('is zero when nothing waits', () => {
    expect(load({ locals: locals({}) } as never)).toEqual({ attentionCount: 0 });
  });

  it('counts best-effort: a failing module contributes zero instead of breaking every page', () => {
    const result = load({
      locals: locals({
        listPendingReviews: () => {
          throw new Error('importer store gone');
        },
        listAcquisitions: () => ({ acquisitions: [awaiting] }),
      }),
    } as never);
    expect(result).toEqual({ attentionCount: 1 });
  });
});
