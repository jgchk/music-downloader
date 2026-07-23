import { describe, expect, it } from 'vitest';
import type { Logger } from 'pino';
import type { DownloaderFacade } from '@music/downloader';
import type { ImporterFacade } from '@music/importer';
import { load } from './+page.server.js';

function locals(over: { listPendingReviews?: () => unknown; listAcquisitions?: () => unknown }): {
  locals: App.Locals;
  warnings: unknown[];
} {
  const warnings: unknown[] = [];
  return {
    warnings,
    locals: {
      facades: {
        importer: {
          listPendingReviews: over.listPendingReviews ?? (() => ({ reviews: [] })),
        } as unknown as ImporterFacade,
        downloader: {
          listAcquisitions: over.listAcquisitions ?? (() => ({ acquisitions: [] })),
        } as unknown as DownloaderFacade,
      },
      logger: { warn: (context: unknown) => void warnings.push(context) } as unknown as Logger,
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
  awaitingSelection: true,
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
    const { locals: event, warnings } = locals({
      listPendingReviews: () => ({ reviews: [pendingReview] }),
      listAcquisitions: () => ({ acquisitions: [awaitingAcquisition] }),
    });
    expect(load({ locals: event } as never)).toEqual({
      items: [reviewItem, editionItem],
      errors: { importer: undefined, downloader: undefined },
    });
    expect(warnings).toEqual([]);
  });

  it('yields the downloader items plus a modeled and logged importer section error when the importer read throws', () => {
    const fault = new Error('importer store gone');
    const { locals: event, warnings } = locals({
      listPendingReviews: () => {
        throw fault;
      },
      listAcquisitions: () => ({ acquisitions: [awaitingAcquisition] }),
    });
    expect(load({ locals: event } as never)).toEqual({
      items: [editionItem],
      errors: { importer: 'Import reviews are unavailable right now.', downloader: undefined },
    });
    // The degradation is user-modeled AND operator-visible: the fault itself is logged.
    expect(warnings).toEqual([{ err: fault, module: 'importer' }]);
  });

  it('yields the importer items plus a modeled and logged downloader section error when the downloader read throws', () => {
    const fault = new Error('downloader store gone');
    const { locals: event, warnings } = locals({
      listPendingReviews: () => ({ reviews: [pendingReview] }),
      listAcquisitions: () => {
        throw fault;
      },
    });
    expect(load({ locals: event } as never)).toEqual({
      items: [reviewItem],
      errors: { importer: undefined, downloader: 'Acquisitions are unavailable right now.' },
    });
    expect(warnings).toEqual([{ err: fault, module: 'downloader' }]);
  });

  it('models both section errors with an empty list when both reads throw', () => {
    const { locals: event, warnings } = locals({
      listPendingReviews: () => {
        throw new Error('importer store gone');
      },
      listAcquisitions: () => {
        throw new Error('downloader store gone');
      },
    });
    expect(load({ locals: event } as never)).toEqual({
      items: [],
      errors: {
        importer: 'Import reviews are unavailable right now.',
        downloader: 'Acquisitions are unavailable right now.',
      },
    });
    expect(warnings).toHaveLength(2);
  });
});
