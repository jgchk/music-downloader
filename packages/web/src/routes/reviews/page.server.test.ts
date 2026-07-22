import { describe, expect, it } from 'vitest';
import type { DownloaderFacade } from '@music/downloader';
import type { ImporterFacade } from '@music/importer';
import { load } from './+page.server.js';

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
const awaitingAcquisition = {
  acquisitionId: 'acq-1',
  status: 'AwaitingManualSelection',
  attempts: 0,
  rejectedCount: 0,
  history: [],
  candidates: [{ releaseMbid: 'r1', title: 'OK Computer', trackCount: 12 }],
};

const reviewItem = {
  module: 'importer',
  kind: 'match-review',
  id: 'imp-1',
  title: '/intake/a',
  waitingSince: undefined,
  href: '/reviews/imp-1',
};

const editionItem = {
  module: 'downloader',
  kind: 'edition-selection',
  id: 'acq-1',
  title: 'OK Computer — awaiting your edition choice',
  waitingSince: undefined,
  href: '/acquisitions/acq-1',
};

describe('attention queue load', () => {
  it('composes both facades into one attention-item list with no section errors', () => {
    const result = load({
      locals: locals({
        listPendingReviews: () => ({ reviews: [pendingReview] }),
        listAcquisitions: () => ({ acquisitions: [awaitingAcquisition] }),
      }),
    } as never);
    expect(result).toEqual({
      items: [reviewItem, editionItem],
      errors: { importer: undefined, downloader: undefined },
    });
  });

  it('yields the downloader items plus a modeled importer section error when the importer read throws', () => {
    const result = load({
      locals: locals({
        listPendingReviews: () => {
          throw new Error('importer store gone');
        },
        listAcquisitions: () => ({ acquisitions: [awaitingAcquisition] }),
      }),
    } as never);
    expect(result).toEqual({
      items: [editionItem],
      errors: { importer: 'Import reviews are unavailable right now.', downloader: undefined },
    });
  });

  it('yields the importer items plus a modeled downloader section error when the downloader read throws', () => {
    const result = load({
      locals: locals({
        listPendingReviews: () => ({ reviews: [pendingReview] }),
        listAcquisitions: () => {
          throw new Error('downloader store gone');
        },
      }),
    } as never);
    expect(result).toEqual({
      items: [reviewItem],
      errors: { importer: undefined, downloader: 'Acquisitions are unavailable right now.' },
    });
  });
});
