import { describe, expect, it, vi } from 'vitest';
import { isHttpError, isRedirect } from '@sveltejs/kit';
import type { DownloaderFacade } from '@music/downloader';
import { actions, load } from './+page.server.js';

const base = {
  acquisitionId: 'acq-1',
  status: 'Searching',
  attempts: 1,
  rejectedCount: 0,
  history: [],
};

function eventFor(facade: Record<string, unknown>) {
  return {
    params: { id: 'acq-1' },
    locals: { facades: { downloader: facade as unknown as DownloaderFacade } },
  } as never;
}

describe('acquisition detail load', () => {
  it('returns the status without progress while not downloading', () => {
    const facade = {
      getAcquisition: () => ({ ok: true, value: base }),
      getAcquisitionProgress: vi.fn(),
    };
    expect(load(eventFor(facade))).toEqual({ acquisition: base, progress: undefined });
    expect(facade.getAcquisitionProgress).not.toHaveBeenCalled();
  });

  it('adds live progress while downloading', () => {
    const downloading = { ...base, status: 'Downloading' };
    const progress = { percent: 40, bytesTransferred: 4, bytesTotal: 10 };
    const facade = {
      getAcquisition: () => ({ ok: true, value: downloading }),
      getAcquisitionProgress: () => ({ ok: true, value: progress }),
    };
    expect(load(eventFor(facade))).toEqual({ acquisition: downloading, progress });
  });

  it('omits progress when the progress query itself fails', () => {
    const downloading = { ...base, status: 'Downloading' };
    const facade = {
      getAcquisition: () => ({ ok: true, value: downloading }),
      getAcquisitionProgress: () => ({ ok: false, error: { kind: 'NotFound' } }),
    };
    expect(load(eventFor(facade))).toEqual({ acquisition: downloading, progress: undefined });
  });

  it('404s a missing acquisition', () => {
    const facade = { getAcquisition: () => ({ ok: false, error: { kind: 'NotFound' } }) };
    expect(() => load(eventFor(facade))).toThrowError(
      expect.toSatisfy((thrown: unknown) => isHttpError(thrown) && thrown.status === 404),
    );
  });
});

describe('cancel action', () => {
  it('dispatches cancel and redirects back to the detail', async () => {
    const cancelAcquisition = vi
      .fn()
      .mockResolvedValue({ ok: true, value: { acquisitionId: 'acq-1' } });
    await expect(actions.cancel!(eventFor({ cancelAcquisition }))).rejects.toSatisfy(
      (thrown: unknown) => isRedirect(thrown) && thrown.location === '/acquisitions/acq-1',
    );
    expect(cancelAcquisition).toHaveBeenCalledWith({ id: 'acq-1' });
  });

  it('surfaces a modeled cancel failure', async () => {
    const cancelAcquisition = vi.fn().mockResolvedValue({
      ok: false,
      error: { kind: 'InfraError', operation: 'store', message: 'x' },
    });
    const result = (await actions.cancel!(eventFor({ cancelAcquisition }))) as {
      status: number;
      data: { message: string };
    };
    expect(result.status).toBe(500);
    expect(result.data.message).toContain('store');
  });
});
