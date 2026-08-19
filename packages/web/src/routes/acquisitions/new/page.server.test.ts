/** The story the `handle` hook would have minted for this request. */
const STORY = 'a1b2c3d4e5f60718293a4b5c6d7e8f90';

import { describe, expect, it, vi } from 'vitest';
import { isRedirect } from '@sveltejs/kit';
import type { DownloaderFacade } from '@music/downloader';
import { actions } from './+page.server.js';

function event(fields: Record<string, string>, facade: Record<string, unknown>) {
  const data = new FormData();
  for (const [k, v] of Object.entries(fields)) data.set(k, v);
  return {
    request: { formData: () => Promise.resolve(data) },
    locals: {
      facades: { downloader: facade as unknown as DownloaderFacade },
      correlationId: STORY,
    },
  } as never;
}

describe('the request action, which keeps the page', () => {
  it('answers with the new download instead of navigating away from the search', async () => {
    const submitAcquisition = vi
      .fn()
      .mockResolvedValue({ ok: true, value: { acquisitionId: 'acq-9' } });

    const answer = await actions.request!(
      event({ kind: 'release-group', mbid: 'mb-1', title: 'Graceland' }, { submitAcquisition }),
    );

    // A redirect here would throw away the query, its results, and whatever was open — the whole
    // reason someone can ask for five records in a row.
    expect(answer).toEqual({ requested: { acquisitionId: 'acq-9', title: 'Graceland' } });
  });

  it('names the download by what was asked for, when the form said', async () => {
    const submitAcquisition = vi
      .fn()
      .mockResolvedValue({ ok: true, value: { acquisitionId: 'acq-9' } });

    const answer = await actions.request!(
      event({ kind: 'release-group', mbid: 'mb-1' }, { submitAcquisition }),
    );

    // No title on the form is not a reason to say nothing: the identifier is still an answer.
    expect(answer).toEqual({ requested: { acquisitionId: 'acq-9', title: undefined } });
  });

  it('refuses the way the page\u{2019}s own form does, so one failure path is rendered', async () => {
    const submitAcquisition = vi
      .fn()
      .mockResolvedValue({ ok: false, error: { kind: 'ValidationFailed', message: 'no target' } });

    const answer = (await actions.request!(
      event({ kind: 'release-group' }, { submitAcquisition }),
    )) as { status: number; data: { message: string } };

    expect(answer.status).toBe(400);
    expect(answer.data.message).toContain('no target');
  });
});

describe('submit acquisition action', () => {
  it('dispatches the facade submit command and redirects to the new acquisition', async () => {
    const submitAcquisition = vi
      .fn()
      .mockResolvedValue({ ok: true, value: { acquisitionId: 'acq-9' } });
    await expect(
      actions.submit!(
        event({ kind: 'musicbrainz', mbid: 'mb-1', targetType: 'album' }, { submitAcquisition }),
      ),
    ).rejects.toSatisfy(
      (thrown: unknown) => isRedirect(thrown) && thrown.location === '/acquisitions/acq-9',
    );
    expect(submitAcquisition).toHaveBeenCalledWith(
      { request: { kind: 'musicbrainz', mbid: 'mb-1', targetType: 'album' } },
      // Exactly the story on `locals` — a route that minted its own would also be 32 hex, and that
      // is the bug the mint-once-at-the-hook design forbids.
      STORY,
    );
  });

  it('re-renders the modeled failure with the typed values', async () => {
    const submitAcquisition = vi.fn().mockResolvedValue({
      ok: false,
      error: { kind: 'ValidationFailed', message: 'mbid required' },
    });
    const result = (await actions.submit!(
      event({ kind: 'musicbrainz', targetType: 'album' }, { submitAcquisition }),
    )) as { status: number; data: { message: string; values: Record<string, string> } };
    expect(result.status).toBe(400);
    expect(result.data.message).toContain('mbid required');
    expect(result.data.values).toEqual({ kind: 'musicbrainz', targetType: 'album' });
  });
});
