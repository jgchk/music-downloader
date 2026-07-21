import { render } from 'svelte/server';
import { describe, expect, it } from 'vitest';
import Page from './+page.svelte';

describe('reviews page (SSR)', () => {
  it('renders the queue over its load data', () => {
    const { body } = render(Page, {
      props: { data: { list: { reviews: [] } }, params: {}, form: null },
    });
    expect(body).toContain('<h1>Reviews</h1>');
    expect(body).toContain('data-testid="empty"');
  });
});
