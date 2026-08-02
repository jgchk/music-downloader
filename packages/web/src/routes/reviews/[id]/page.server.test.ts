import { describe, expect, it, vi } from 'vitest';
import { isHttpError, isRedirect } from '@sveltejs/kit';
import type { DownloaderFacade } from '@music/downloader';
import type { ImporterFacade } from '@music/importer';
import { actions, load } from './+page.server.js';

const pending = {
  importId: 'imp-1',
  path: '/intake/x',
  review: { kind: 'no-match' as const },
};

const acquisition = {
  acquisitionId: 'acq-1',
  status: 'Fulfilled',
  attempts: 1,
  rejectedCount: 0,
  history: [],
  target: { artist: 'Artist', title: 'Album' },
};

function eventFor(
  importer: Record<string, unknown>,
  fields: Record<string, string> = {},
  downloader: Record<string, unknown> = {},
) {
  const data = new FormData();
  for (const [k, v] of Object.entries(fields)) data.set(k, v);
  return {
    params: { id: 'imp-1' },
    request: { formData: () => Promise.resolve(data) },
    locals: {
      facades: {
        importer: importer as unknown as ImporterFacade,
        downloader: downloader as unknown as DownloaderFacade,
      },
    },
  } as never;
}

describe('review detail load', () => {
  it('finds the pending review and composes its musical-intent title', () => {
    const facade = {
      listPendingReviews: () => ({ reviews: [pending] }),
      getImport: () => ({ ok: true, value: { importId: 'imp-1', acquisitionId: 'acq-1' } }),
    };
    const downloader = { getAcquisition: () => ({ ok: true, value: acquisition }) };
    expect(load(eventFor(facade, {}, downloader))).toEqual({
      pending,
      title: 'Artist — Album',
    });
  });

  it('degrades the title to the staged basename when no correlation composes', () => {
    const facade = {
      listPendingReviews: () => ({ reviews: [pending] }),
      getImport: () => ({ ok: false, error: { kind: 'NotFound' } }),
    };
    expect(load(eventFor(facade))).toEqual({ pending, title: 'x' });
  });

  it('404s when no review is open for the id', () => {
    const facade = { listPendingReviews: () => ({ reviews: [] }) };
    expect(() => load(eventFor(facade))).toThrowError(
      expect.toSatisfy((thrown: unknown) => isHttpError(thrown) && thrown.status === 404),
    );
  });
});

describe('resolve action', () => {
  it('dispatches the reshaped resolution and returns to the queue', async () => {
    const resolveReview = vi.fn().mockResolvedValue({ ok: true, value: { importId: 'imp-1' } });
    await expect(
      actions.resolve!(eventFor({ resolveReview }, { verb: 'supply-id', mbReleaseId: 'mb-2' })),
    ).rejects.toSatisfy((thrown: unknown) => isRedirect(thrown) && thrown.location === '/reviews');
    expect(resolveReview).toHaveBeenCalledWith({
      id: 'imp-1',
      resolution: { verb: 'supply-id', mbReleaseId: 'mb-2' },
    });
  });

  it('holds an unconfirmed destructive resolution at the confirm step — nothing dispatches', async () => {
    const resolveReview = vi.fn();
    const result = await actions.resolve!(
      eventFor({ resolveReview }, { verb: 'reject', reason: 'bad rip' }),
    );
    expect(result).toEqual({ confirm: { verb: 'reject', reason: 'bad rip', reasons: undefined } });
    expect(resolveReview).not.toHaveBeenCalled();
  });

  it('holds the unusable-delivery rejection likewise, echoing its reasons', async () => {
    const resolveReview = vi.fn();
    const result = await actions.resolve!(
      eventFor({ resolveReview }, { verb: 'reject-unusable-delivery', reasons: 'truncated' }),
    );
    expect(result).toEqual({
      confirm: { verb: 'reject-unusable-delivery', reason: undefined, reasons: 'truncated' },
    });
    expect(resolveReview).not.toHaveBeenCalled();
  });

  it('dispatches a confirmed destructive resolution', async () => {
    const resolveReview = vi.fn().mockResolvedValue({ ok: true, value: { importId: 'imp-1' } });
    await expect(
      actions.resolve!(
        eventFor({ resolveReview }, { verb: 'reject', reason: 'bad rip', confirmed: 'true' }),
      ),
    ).rejects.toSatisfy((thrown: unknown) => isRedirect(thrown) && thrown.location === '/reviews');
    expect(resolveReview).toHaveBeenCalledWith({
      id: 'imp-1',
      resolution: { verb: 'reject', reason: 'bad rip' },
    });
  });

  it('surfaces the stale-resolution conflict as the modeled error (web-ui spec)', async () => {
    const resolveReview = vi.fn().mockResolvedValue({ ok: false, error: { kind: 'NoOpenReview' } });
    const result = (await actions.resolve!(
      eventFor({ resolveReview }, { verb: 'reject', confirmed: 'true' }),
    )) as {
      status: number;
      data: { message: string };
    };
    expect(result.status).toBe(409);
    expect(result.data.message).toContain('already been settled');
  });

  it('surfaces the missing-retained-candidate refusal with reject still available', async () => {
    const resolveReview = vi
      .fn()
      .mockResolvedValue({ ok: false, error: { kind: 'NoRetainedCandidate' } });
    const result = (await actions.resolve!(
      eventFor({ resolveReview }, { verb: 'reject-unusable-delivery', confirmed: 'true' }),
    )) as { status: number; data: { message: string } };
    expect(result.status).toBe(409);
    expect(result.data.message).toContain('Plain reject is still available');
  });
});
