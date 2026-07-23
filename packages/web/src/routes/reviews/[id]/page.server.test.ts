import { describe, expect, it, vi } from 'vitest';
import { isHttpError, isRedirect } from '@sveltejs/kit';
import type { ImporterFacade } from '@music/importer';
import { actions, load } from './+page.server.js';

const pending = {
  importId: 'imp-1',
  path: '/intake/x',
  review: { kind: 'no-match' as const },
};

function eventFor(facade: Record<string, unknown>, fields: Record<string, string> = {}) {
  const data = new FormData();
  for (const [k, v] of Object.entries(fields)) data.set(k, v);
  return {
    params: { id: 'imp-1' },
    request: { formData: () => Promise.resolve(data) },
    locals: { facades: { importer: facade as unknown as ImporterFacade } },
  } as never;
}

describe('review detail load', () => {
  it('finds the pending review by import id', () => {
    const facade = { listPendingReviews: () => ({ reviews: [pending] }) };
    expect(load(eventFor(facade))).toEqual({ pending });
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

  it('surfaces the stale-resolution conflict as the modeled error (web-ui spec)', async () => {
    const resolveReview = vi.fn().mockResolvedValue({ ok: false, error: { kind: 'NoOpenReview' } });
    const result = (await actions.resolve!(eventFor({ resolveReview }, { verb: 'reject' }))) as {
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
      eventFor({ resolveReview }, { verb: 'reject-unusable-delivery' }),
    )) as { status: number; data: { message: string } };
    expect(result.status).toBe(409);
    expect(result.data.message).toContain('Plain reject is still available');
  });
});
