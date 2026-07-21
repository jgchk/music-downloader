import { describe, expect, it } from 'vitest';
import type { DownloaderFacade } from '@music/downloader';
import { load } from './+page.server.js';

describe('acquisitions list load', () => {
  it('returns the facade list read model unchanged', () => {
    const list = { acquisitions: [{ acquisitionId: 'acq-1' }] };
    const facades = {
      downloader: { listAcquisitions: () => list } as unknown as DownloaderFacade,
    };
    expect(load({ locals: { facades } } as never)).toEqual({ list });
  });
});
