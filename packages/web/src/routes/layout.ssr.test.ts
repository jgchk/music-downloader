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
      props: { data: { attentionCount: 0, pathname: '/' }, params: {}, children },
    });
    // The shell owns exactly one main landmark; pages render inside it.
    expect(body.match(/<main[\s>]/g)).toHaveLength(1);
    expect(body).toContain('<header');
    expect(body).toContain('<footer');
    // The primary navigation is a labelled landmark.
    expect(body).toMatch(/<nav[^>]*aria-label="Primary"/);
    expect(body).toContain('data-testid="page-body"');
  });

  it('marks the active section (including child routes) with aria-current', () => {
    const { body } = render(Layout, {
      props: { data: { attentionCount: 0, pathname: '/acquisitions/acq-1' }, params: {}, children },
    });
    // Acquisitions stays current on its [id] child route; Home does not become current.
    expect(body).toMatch(/<a href="\/acquisitions" aria-current="page"/);
    expect(body).not.toMatch(/<a href="\/" aria-current="page"/);

    // …and on an exact section match (not just a child route).
    const exact = render(Layout, {
      props: { data: { attentionCount: 0, pathname: '/reviews' }, params: {}, children },
    });
    expect(exact.body).toMatch(/<a href="\/reviews" aria-current="page"/);
  });

  it('renders the site navigation with a count badge over the page body', () => {
    const { body } = render(Layout, {
      props: { data: { attentionCount: 2, pathname: '/' }, params: {}, children },
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
      props: { data: { attentionCount: 0, pathname: '/' }, params: {}, children },
    });
    expect(body).toContain('Needs attention');
    expect(body).not.toContain('data-testid="attention-badge"');
  });
});
