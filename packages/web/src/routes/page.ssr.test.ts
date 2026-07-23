import { render } from 'svelte/server';
import { describe, expect, it } from 'vitest';
import Page from './+page.svelte';

describe('landing page (SSR)', () => {
  it('renders the landing view over its load data', () => {
    const { body } = render(Page, {
      props: {
        data: {
          attentionCount: 0,
          pathname: '/',
          acquisitions: { kind: 'ok', count: 4 },
          pendingReviews: { kind: 'ok', count: 0 },
        },
        params: {},
        form: null,
      },
    });
    expect(body).toContain('<h1>Dashboard</h1>');
    expect(body).toContain('data-testid="acquisition-count">4<');
  });
});
