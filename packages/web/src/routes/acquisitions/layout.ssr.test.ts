import { createRawSnippet } from 'svelte';
import { render } from 'svelte/server';
import { describe, expect, it } from 'vitest';
import Layout from './+layout.svelte';

const children = createRawSnippet(() => ({
  render: () => '<h1 data-testid="detail-pane">detail</h1>',
}));

describe('acquisitions master-detail layout (SSR)', () => {
  it('renders the master list beside the child detail pane', () => {
    const { body } = render(Layout, {
      props: {
        data: { attentionCount: 0, list: { acquisitions: [] }, selectedId: undefined },
        params: {},
        children,
      },
    });
    expect(body).toContain('class="master-detail"');
    expect(body).toContain('aria-label="Acquisitions"');
    // The master pane renders the list component (its empty state here)…
    expect(body).toContain('data-testid="empty"');
    // …and the child route renders in the detail pane.
    expect(body).toContain('data-testid="detail-pane"');
  });
});
