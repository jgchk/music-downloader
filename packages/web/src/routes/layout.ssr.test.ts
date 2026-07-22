import { createRawSnippet } from 'svelte';
import { render } from 'svelte/server';
import { describe, expect, it } from 'vitest';
import Layout from './+layout.svelte';

const children = createRawSnippet(() => ({
  render: () => '<main data-testid="page-body">the page</main>',
}));

describe('root layout (SSR)', () => {
  it('renders the site navigation with a count badge over the page body', () => {
    const { body } = render(Layout, {
      props: { data: { attentionCount: 2 }, params: {}, children },
    });
    expect(body).toContain('data-testid="site-nav"');
    expect(body).toContain('href="/acquisitions"');
    expect(body).toContain('Needs attention');
    expect(body).toContain('data-testid="attention-badge"');
    expect(body).toContain('>2<');
    expect(body).toContain('data-testid="page-body"');
  });

  it('renders no badge at all when nothing waits', () => {
    const { body } = render(Layout, {
      props: { data: { attentionCount: 0 }, params: {}, children },
    });
    expect(body).toContain('Needs attention');
    expect(body).not.toContain('data-testid="attention-badge"');
  });
});
