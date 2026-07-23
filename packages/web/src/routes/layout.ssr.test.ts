import { createRawSnippet } from 'svelte';
import { render } from 'svelte/server';
import { describe, expect, it } from 'vitest';
import Layout from './+layout.svelte';

const children = createRawSnippet(() => ({
  render: () => '<div data-testid="page-body">the page</div>',
}));

describe('root layout (SSR)', () => {
  it('frames the page in a single-main landmark skeleton', () => {
    const { body } = render(Layout, {
      props: { data: { attentionCount: 0 }, params: {}, children },
    });
    // The shell owns exactly one main landmark; pages render inside it.
    expect(body.match(/<main[\s>]/g)).toHaveLength(1);
    expect(body).toContain('<header');
    expect(body).toContain('<footer');
    // The primary navigation is a labelled landmark.
    expect(body).toMatch(/<nav[^>]*aria-label="Primary"/);
    expect(body).toContain('data-testid="page-body"');
  });

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
