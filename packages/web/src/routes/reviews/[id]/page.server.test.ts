import { describe, expect, it, vi } from 'vitest';
import { isHttpError, isRedirect } from '@sveltejs/kit';
import type { Logger } from 'pino';
import type { DownloaderFacade } from '@music/downloader';
import type { ImporterFacade } from '@music/importer';
import { RESOLUTION_ACTIONS, isDestructive, type ResolutionVerb } from '$lib/resolution-actions.js';
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

const DESTRUCTIVE_VERBS = (Object.keys(RESOLUTION_ACTIONS) as ResolutionVerb[]).filter((verb) =>
  isDestructive(verb),
);

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
      logger: { warn: vi.fn() } as unknown as Logger,
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
    expect(() => load(eventFor(facade))).toThrow(
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

  it.each(DESTRUCTIVE_VERBS)(
    'holds every inventory-destructive verb at the confirm step — %s dispatches nothing unconfirmed',
    async (verb) => {
      const resolveReview = vi.fn();
      const result = (await actions.resolve!(eventFor({ resolveReview }, { verb }))) as {
        confirm: { verb: string };
      };
      expect(result.confirm.verb).toBe(verb);
      expect(resolveReview).not.toHaveBeenCalled();
    },
  );

  it('echoes the plain rejection’s reason into the pending confirmation', async () => {
    const resolveReview = vi.fn();
    const result = await actions.resolve!(
      eventFor({ resolveReview }, { verb: 'reject', reason: 'bad rip' }),
    );
    expect(result).toEqual({ confirm: { verb: 'reject', reason: 'bad rip' } });
    expect(resolveReview).not.toHaveBeenCalled();
  });

  it('echoes the unusable-delivery rejection’s reasons likewise', async () => {
    const resolveReview = vi.fn();
    const result = await actions.resolve!(
      eventFor({ resolveReview }, { verb: 'reject-unusable-delivery', reasons: 'truncated' }),
    );
    expect(result).toEqual({
      confirm: { verb: 'reject-unusable-delivery', reasons: 'truncated' },
    });
    expect(resolveReview).not.toHaveBeenCalled();
  });

  it('reads the verb exactly as the dispatch will: a whitespace-padded destructive verb still confirms', async () => {
    // The gate and resolveReviewForm must share one trimmed reading — a padded " reject " that
    // slipped the gate would dispatch a file deletion with no confirmation (review finding).
    const resolveReview = vi.fn();
    const result = (await actions.resolve!(
      eventFor({ resolveReview }, { verb: ' reject ', reason: 'bad rip' }),
    )) as { confirm: { verb: string } };
    expect(result.confirm.verb).toBe('reject');
    expect(resolveReview).not.toHaveBeenCalled();
  });

  it('passes an unknown verb straight to the facade to refuse — the gate holds nothing', async () => {
    const resolveReview = vi.fn().mockResolvedValue({ ok: false, error: { kind: 'Validation' } });
    await actions.resolve!(eventFor({ resolveReview }, { verb: 'brand-new-verb' }));
    expect(resolveReview).toHaveBeenCalledWith({
      id: 'imp-1',
      resolution: { verb: 'brand-new-verb' },
    });
  });

  it('refuses a __proto__ verb as a modeled 400, never a thrown 500', async () => {
    // The hostile-POST shape: Object.prototype key names must behave exactly like any unknown
    // verb — reshaped to a bare pass-through the facade refuses — not crash the action.
    const resolveReview = vi
      .fn()
      .mockResolvedValue({ ok: false, error: { kind: 'ValidationFailed', detail: 'bad verb' } });
    const result = await actions.resolve!(eventFor({ resolveReview }, { verb: '__proto__' }));
    expect(resolveReview).toHaveBeenCalledWith({ id: 'imp-1', resolution: { verb: '__proto__' } });
    expect(result).toMatchObject({ status: 400 });
  });

  it('treats a missing verb as non-destructive and lets the facade refuse it', async () => {
    const resolveReview = vi.fn().mockResolvedValue({ ok: false, error: { kind: 'Validation' } });
    await actions.resolve!(eventFor({ resolveReview }, {}));
    expect(resolveReview).toHaveBeenCalled();
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
    expect(result.data.message).toContain('A plain reject is still available');
  });
});
