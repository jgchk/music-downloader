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
        data: {
          attentionCount: 0,
          pathname: '/acquisitions',
          acquisitions: [],
          listFailed: false,
          selectedId: undefined,
        },
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
    expect(body).not.toContain('data-testid="list-error"');
  });

  it('shows a degrade banner when the guarded list read failed', () => {
    const { body } = render(Layout, {
      props: {
        data: {
          attentionCount: 0,
          pathname: '/acquisitions',
          acquisitions: [],
          listFailed: true,
          selectedId: undefined,
        },
        params: {},
        children,
      },
    });
    expect(body).toContain('data-testid="list-error"');
    // The detail pane still renders — a list fault does not take the whole page down.
    expect(body).toContain('data-testid="detail-pane"');
  });
});
