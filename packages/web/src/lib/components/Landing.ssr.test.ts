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
});
