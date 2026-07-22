import { describe, expect, it } from 'vitest';
import type { Logger } from 'pino';
import type { DownloaderFacade } from '@music/downloader';
import type { ImporterFacade } from '@music/importer';
import { load } from './+layout.server.js';

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
    const { locals: event } = locals({
      listPendingReviews: () => ({ reviews: [pendingReview] }),
      listAcquisitions: () => ({ acquisitions: [awaiting, searching] }),
    });
    expect(load({ locals: event } as never)).toEqual({ attentionCount: 2 });
  });

  it('is zero when nothing waits', () => {
    const { locals: event } = locals({});
    expect(load({ locals: event } as never)).toEqual({ attentionCount: 0 });
  });

  it('logs and contributes zero for a failing importer instead of breaking every page', () => {
    const fault = new Error('importer store gone');
    const { locals: event, warnings } = locals({
      listPendingReviews: () => {
        throw fault;
      },
      listAcquisitions: () => ({ acquisitions: [awaiting] }),
    });
    expect(load({ locals: event } as never)).toEqual({ attentionCount: 1 });
    expect(warnings).toEqual([{ err: fault, module: 'importer' }]);
  });

  it('logs and contributes zero for a failing downloader instead of breaking every page', () => {
    const fault = new Error('downloader store gone');
    const { locals: event, warnings } = locals({
      listPendingReviews: () => ({ reviews: [pendingReview] }),
      listAcquisitions: () => {
        throw fault;
      },
    });
    expect(load({ locals: event } as never)).toEqual({ attentionCount: 1 });
    expect(warnings).toEqual([{ err: fault, module: 'downloader' }]);
  });
});
