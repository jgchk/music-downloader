import { render } from 'svelte/server';
import { describe, expect, it } from 'vitest';
import Page from './+page.svelte';

describe('acquisitions page (SSR)', () => {
  it('renders the list view over its load data', () => {
    const { body } = render(Page, {
      props: { data: { list: { acquisitions: [] } }, params: {}, form: null },
    });
    expect(body).toContain('<h1>Acquisitions</h1>');
    expect(body).toContain('data-testid="empty"');
  });
});
