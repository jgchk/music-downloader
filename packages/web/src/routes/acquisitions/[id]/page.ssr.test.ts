import { render } from 'svelte/server';
import { describe, expect, it, vi } from 'vitest';

// SSR renders never navigate; the liveness effect (client-only) sees a no-op.
vi.mock('$app/navigation', () => ({ invalidateAll: vi.fn() }));

const { default: Page } = await import('./+page.svelte');

describe('acquisition detail page (SSR)', () => {
  it('renders the detail view over its load data with an action failure', () => {
    const { body } = render(Page, {
      props: {
        data: {
          username: 'jake',
          attentionCount: 0,
          pathname: '/acquisitions/acq-1',
          acquisitions: [],
          listFailed: false,
          selectedId: 'acq-1',
          acquisition: {
            acquisitionId: 'acq-1',
            status: 'Searching',
            attempts: 2,
            rejectedCount: 1,
            history: [],
            cancellable: true,
          },
          timeline: [],
          importSection: { state: 'none' },
          now: '2026-08-01T12:00:00Z',
          progress: undefined,
          progressUnavailable: false,
        },
        params: { id: 'acq-1' },
        form: { message: 'The record changed while you were working - reload and try again.' },
      },
    });
    expect(body).toContain('data-testid="status">Searching<');
    expect(body).toContain('2 attempts · 1 source rejected');
    expect(body).toContain('data-testid="action-error"');
    // The live page always says what is happening now.
    expect(body).toContain('data-testid="pending-row"');
  });
});
