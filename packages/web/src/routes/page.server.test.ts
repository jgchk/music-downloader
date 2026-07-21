import { describe, expect, it } from 'vitest';
import type { DownloaderFacade } from '@music/downloader';
import type { ImporterFacade } from '@music/importer';
import { load } from './+page.server.js';

describe('landing load', () => {
  it('composes counts from independent facade queries (reads only)', () => {
    const facades = {
      downloader: {
        listAcquisitions: () => ({ acquisitions: [{}, {}] }),
      } as unknown as DownloaderFacade,
      importer: {
        listPendingReviews: () => ({ reviews: [{}] }),
      } as unknown as ImporterFacade,
    };
    const result = load({ locals: { facades } } as never) as {
      counts: { acquisitions: number; pendingReviews: number };
    };
    expect(result.counts).toEqual({ acquisitions: 2, pendingReviews: 1 });
  });
});
