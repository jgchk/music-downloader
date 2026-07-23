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
  it('parses each section as a healthy count from independent facade queries (reads only)', () => {
    const { locals: event } = locals({
      listAcquisitions: () => ({ acquisitions: [{}, {}] }),
      listPendingReviews: () => ({ reviews: [{}] }),
    });
    expect(load({ locals: event } as never)).toEqual({
      acquisitions: { kind: 'ok', count: 2 },
      pendingReviews: { kind: 'ok', count: 1 },
    });
  });

  it('logs and degrades only the acquisitions section to an unavailable apology when its read faults', () => {
    const fault = new Error('downloader store gone');
    const { locals: event, warnings } = locals({
      listAcquisitions: () => {
        throw fault;
      },
      listPendingReviews: () => ({ reviews: [{}] }),
    });
    expect(load({ locals: event } as never)).toEqual({
      acquisitions: { kind: 'unavailable', message: 'Acquisitions are unavailable right now.' },
      pendingReviews: { kind: 'ok', count: 1 },
    });
    expect(warnings).toEqual([{ err: fault, module: 'downloader' }]);
  });

  it('logs and degrades only the reviews section to an unavailable apology when its read faults', () => {
    const fault = new Error('importer store gone');
    const { locals: event, warnings } = locals({
      listAcquisitions: () => ({ acquisitions: [{}, {}] }),
      listPendingReviews: () => {
        throw fault;
      },
    });
    expect(load({ locals: event } as never)).toEqual({
      acquisitions: { kind: 'ok', count: 2 },
      pendingReviews: {
        kind: 'unavailable',
        message: 'Import reviews are unavailable right now.',
      },
    });
    expect(warnings).toEqual([{ err: fault, module: 'importer' }]);
  });
});
