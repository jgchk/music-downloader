import { describe, expect, it } from 'vitest';
import type { Logger } from 'pino';
import type { DownloaderFacade } from '@music/downloader';
import type { ImporterFacade } from '@music/importer';
import { load } from './+page.server.js';

function locals(over: { listAcquisitions?: () => unknown; listPendingReviews?: () => unknown }): {
  locals: App.Locals;
  warnings: unknown[];
} {
  const warnings: unknown[] = [];
  return {
    warnings,
    locals: {
      facades: {
        downloader: {
          listAcquisitions: over.listAcquisitions ?? (() => ({ acquisitions: [] })),
        } as unknown as DownloaderFacade,
        importer: {
          listPendingReviews: over.listPendingReviews ?? (() => ({ reviews: [] })),
        } as unknown as ImporterFacade,
      },
      logger: { warn: (context: unknown) => void warnings.push(context) } as unknown as Logger,
    },
  };
}

describe('landing load', () => {
  it('composes counts from independent facade queries (reads only), no failures', () => {
    const { locals: event } = locals({
      listAcquisitions: () => ({ acquisitions: [{}, {}] }),
      listPendingReviews: () => ({ reviews: [{}] }),
    });
    expect(load({ locals: event } as never)).toEqual({
      counts: { acquisitions: 2, pendingReviews: 1 },
      errors: { acquisitions: undefined, pendingReviews: undefined },
    });
  });

  it('logs and degrades only the acquisitions section when its read faults, still rendering', () => {
    const fault = new Error('downloader store gone');
    const { locals: event, warnings } = locals({
      listAcquisitions: () => {
        throw fault;
      },
      listPendingReviews: () => ({ reviews: [{}] }),
    });
    expect(load({ locals: event } as never)).toEqual({
      counts: { acquisitions: 0, pendingReviews: 1 },
      errors: {
        acquisitions: 'Acquisitions are unavailable right now.',
        pendingReviews: undefined,
      },
    });
    expect(warnings).toEqual([{ err: fault, module: 'downloader' }]);
  });

  it('logs and degrades only the reviews section when its read faults, still rendering', () => {
    const fault = new Error('importer store gone');
    const { locals: event, warnings } = locals({
      listAcquisitions: () => ({ acquisitions: [{}, {}] }),
      listPendingReviews: () => {
        throw fault;
      },
    });
    expect(load({ locals: event } as never)).toEqual({
      counts: { acquisitions: 2, pendingReviews: 0 },
      errors: {
        acquisitions: undefined,
        pendingReviews: 'Import reviews are unavailable right now.',
      },
    });
    expect(warnings).toEqual([{ err: fault, module: 'importer' }]);
  });
});
