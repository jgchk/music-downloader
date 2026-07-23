import { render } from 'svelte/server';
import { describe, expect, it } from 'vitest';
import Page from './+page.svelte';

describe('acquisitions index page (SSR)', () => {
  it('renders the detail-pane empty state', () => {
    // The list (master) is rendered by +layout.svelte; the index page is only the empty
    // detail pane shown until an acquisition is selected.
    const { body } = render(Page);
    expect(body).toContain('<h1>Acquisitions</h1>');
    expect(body).toContain('data-testid="detail-empty"');
  });
});
