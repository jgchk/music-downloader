import { render } from 'svelte/server';
import { describe, expect, it } from 'vitest';
import Landing from './Landing.svelte';

describe('Landing (SSR)', () => {
  it('renders the facade-backed counts as the dashboard body', () => {
    const { body } = render(Landing, {
      props: { counts: { acquisitions: 3, pendingReviews: 1 } },
    });
    // Brand, primary nav, and the request action now live in the app shell
    // (+layout.svelte); Landing is just the dashboard body — a title and the two
    // facade-backed counts.
    expect(body).toContain('<h1>Dashboard</h1>');
    expect(body).toContain('data-testid="acquisition-count">3<');
    expect(body).toContain('data-testid="review-count">1<');
  });

  it('shows the acquisitions apology, not a false zero, when only that read failed', () => {
    const { body } = render(Landing, {
      props: {
        counts: { acquisitions: 0, pendingReviews: 4 },
        errors: {
          acquisitions: 'Acquisitions are unavailable right now.',
          pendingReviews: undefined,
        },
      },
    });
    expect(body).toContain('data-testid="acquisition-error"');
    expect(body).toContain('Acquisitions are unavailable right now.');
    // The failed section shows no count claim; the healthy one still does.
    expect(body).not.toContain('data-testid="acquisition-count"');
    expect(body).toContain('data-testid="review-count">4<');
  });

  it('shows the reviews apology, not a false zero, when only that read failed', () => {
    const { body } = render(Landing, {
      props: {
        counts: { acquisitions: 7, pendingReviews: 0 },
        errors: {
          acquisitions: undefined,
          pendingReviews: 'Import reviews are unavailable right now.',
        },
      },
    });
    expect(body).toContain('data-testid="review-error"');
    expect(body).toContain('Import reviews are unavailable right now.');
    expect(body).not.toContain('data-testid="review-count"');
    expect(body).toContain('data-testid="acquisition-count">7<');
  });
});
