import { beforeEach, describe, expect, it, vi } from 'vitest';
import { isHttpError, isRedirect } from '@sveltejs/kit';
import type { DownloaderFacade } from '@music/downloader';
import type { ImporterFacade } from '@music/importer';
import { actions, load } from './+page.server.js';

const base = {
  acquisitionId: 'acq-1',
  status: 'Searching',
  attempts: 1,
  rejectedCount: 0,
  history: [],
};

const logger = { warn: vi.fn(), error: vi.fn() };

/** The default import read: no import yet for this acquisition (the `NotFound` → `none` path). */
const noImport = { getImportForAcquisition: () => ({ ok: false, error: { kind: 'NotFound' } }) };

function eventFor(facade: Record<string, unknown>, importer: Record<string, unknown> = noImport) {
  return {
    params: { id: 'acq-1' },
    locals: {
      facades: {
        downloader: facade as unknown as DownloaderFacade,
        importer: importer as unknown as ImporterFacade,
      },
      logger,
    },
  } as never;
}

function selectEventFor(facade: Record<string, unknown>, releaseMbid: string) {
  const data = new FormData();
  data.set('releaseMbid', releaseMbid);
  return {
    params: { id: 'acq-1' },
    locals: { facades: { downloader: facade as unknown as DownloaderFacade } },
    request: { formData: () => Promise.resolve(data) },
  } as never;
}

describe('acquisition detail load', () => {
  beforeEach(() => {
    logger.warn.mockClear();
    logger.error.mockClear();
  });

  it('returns the status, an empty timeline, and no-import state while not downloading', () => {
    const facade = {
      getAcquisition: () => ({ ok: true, value: base }),
      getAcquisitionProgress: vi.fn(),
    };
    expect(load(eventFor(facade))).toEqual({
      acquisition: base,
      timeline: [],
      importState: 'none',
      progress: undefined,
      progressUnavailable: false,
    });
  });

  it('adds live progress while downloading', () => {
    const downloading = { ...base, status: 'Downloading' };
    const progress = { percent: 40, bytesTransferred: 4, bytesTotal: 10 };
    const facade = {
      getAcquisition: () => ({ ok: true, value: downloading }),
      getAcquisitionProgress: () => ({ ok: true, value: progress }),
    };
    expect(load(eventFor(facade))).toEqual({
      acquisition: downloading,
      timeline: [],
      importState: 'none',
      progress,
      progressUnavailable: false,
    });
    expect(logger.warn).not.toHaveBeenCalled();
  });

  it('flags progress unavailable and logs the inconsistency when the progress read fails while downloading', () => {
    const downloading = { ...base, status: 'Downloading' };
    const facade = {
      getAcquisition: () => ({ ok: true, value: downloading }),
      getAcquisitionProgress: () => ({ ok: false, error: { kind: 'NotFound' } }),
    };
    // A failed progress read while Downloading is a real cross-projection inconsistency (the
    // "pending forever" family), not the just-started case — it must be surfaced, not collapsed.
    expect(load(eventFor(facade))).toEqual({
      acquisition: downloading,
      timeline: [],
      importState: 'none',
      progress: undefined,
      progressUnavailable: true,
    });
    expect(logger.warn).toHaveBeenCalledOnce();
    expect(logger.warn).toHaveBeenCalledWith(
      { acquisitionId: 'acq-1', err: { kind: 'NotFound' } },
      expect.stringMatching(/progress/),
    );
  });

  it('merges the importer history into the acquisition timeline, ordered by occurrence time', () => {
    const acquisition = {
      ...base,
      status: 'Fulfilled',
      history: [
        { kind: 'selected', at: '2026-01-01T00:00:00Z', candidate: { username: 'u', path: 'p' } },
        {
          kind: 'imported',
          at: '2026-01-01T00:00:04Z',
          candidate: { username: 'u', path: 'p' },
          location: '/stage/x',
        },
      ],
    };
    const importStatus = {
      importId: 'imp-1',
      acquisitionId: 'acq-1',
      status: 'applied',
      history: [
        { kind: 'requested', at: '2026-01-01T00:00:05Z' },
        { kind: 'applied', at: '2026-01-01T00:00:09Z', location: '/lib/x' },
      ],
    };
    const facade = { getAcquisition: () => ({ ok: true, value: acquisition }) };
    const importer = { getImportForAcquisition: () => ({ ok: true, value: importStatus }) };

    const result = load(eventFor(facade, importer)) as unknown as {
      importState: string;
      timeline: { module: string; at: string }[];
    };

    expect(result.importState).toBe('present');
    expect(result.timeline.map((t) => [t.module, t.at])).toEqual([
      ['downloader', '2026-01-01T00:00:00Z'],
      ['downloader', '2026-01-01T00:00:04Z'],
      ['importer', '2026-01-01T00:00:05Z'],
      ['importer', '2026-01-01T00:00:09Z'],
    ]);
  });

  it('degrades the import section and logs when the importer read returns a fault', () => {
    const facade = { getAcquisition: () => ({ ok: true, value: base }) };
    const importer = {
      getImportForAcquisition: () => ({
        ok: false,
        error: { kind: 'InfraError', operation: 'read', message: 'x' },
      }),
    };
    const result = load(eventFor(facade, importer)) as unknown as { importState: string };
    expect(result.importState).toBe('unavailable');
    expect(logger.warn).toHaveBeenCalledWith(
      { acquisitionId: 'acq-1', err: { kind: 'InfraError', operation: 'read', message: 'x' } },
      expect.stringMatching(/import/),
    );
  });

  it('degrades the import section and logs when the importer read throws', () => {
    const facade = { getAcquisition: () => ({ ok: true, value: base }) };
    const importer = {
      getImportForAcquisition: () => {
        throw new Error('boom');
      },
    };
    const result = load(eventFor(facade, importer)) as unknown as { importState: string };
    expect(result.importState).toBe('unavailable');
    expect(logger.warn).toHaveBeenCalledWith(
      expect.objectContaining({ acquisitionId: 'acq-1' }),
      expect.stringMatching(/import/),
    );
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

describe('select action', () => {
  it('dispatches the chosen edition and redirects back to the detail', async () => {
    const selectEdition = vi
      .fn()
      .mockResolvedValue({ ok: true, value: { acquisitionId: 'acq-1' } });
    await expect(actions.select!(selectEventFor({ selectEdition }, 'boot-1'))).rejects.toSatisfy(
      (thrown: unknown) => isRedirect(thrown) && thrown.location === '/acquisitions/acq-1',
    );
    expect(selectEdition).toHaveBeenCalledWith({ id: 'acq-1', releaseMbid: 'boot-1' });
  });

  it('passes a malformed post (no releaseMbid) through as an empty selection for the facade to refuse', async () => {
    const selectEdition = vi.fn().mockResolvedValue({
      ok: false,
      error: { kind: 'ValidationFailed', message: 'releaseMbid required' },
    });
    const event = {
      params: { id: 'acq-1' },
      locals: { facades: { downloader: { selectEdition } as unknown as DownloaderFacade } },
      request: { formData: () => Promise.resolve(new FormData()) },
    } as never;
    const result = (await actions.select!(event)) as { status: number };
    expect(result.status).toBe(400);
    expect(selectEdition).toHaveBeenCalledWith({ id: 'acq-1', releaseMbid: '' });
  });

  it('surfaces the modeled rejection for an off-menu selection', async () => {
    const selectEdition = vi.fn().mockResolvedValue({
      ok: false,
      error: { kind: 'UnknownEdition', releaseMbid: 'off-menu' },
    });
    const result = (await actions.select!(selectEventFor({ selectEdition }, 'off-menu'))) as {
      status: number;
      data: { message: string };
    };
    expect(result.status).toBe(400);
    expect(result.data.message).toContain('off-menu');
  });

  it('surfaces the modeled rejection for a stale selection (the acquisition moved on)', async () => {
    const selectEdition = vi.fn().mockResolvedValue({
      ok: false,
      error: { kind: 'IllegalTransition', command: 'SelectEdition', phase: 'Searching' },
    });
    const result = (await actions.select!(selectEventFor({ selectEdition }, 'boot-1'))) as {
      status: number;
      data: { message: string };
    };
    expect(result.status).toBe(409);
    expect(result.data.message).toContain('Searching');
  });
});
