import { createRawSnippet } from 'svelte';
import { render } from 'svelte/server';
import { describe, expect, it } from 'vitest';
import Layout from './+layout.svelte';

const children = createRawSnippet(() => ({
  render: () => '<div data-testid="page-body">the page</div>',
}));

/** Authenticated layout data unless a test overrides it; `username: undefined` = signed out. */
function data(over: Partial<{ attentionCount: number; pathname: string; username?: string }> = {}) {
  return { attentionCount: 0, pathname: '/', username: 'jake', ...over };
}

describe('root layout (SSR)', () => {
  it('frames the page in a single-main landmark skeleton', () => {
    const { body } = render(Layout, { props: { data: data(), params: {}, children } });
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
      props: { data: data({ pathname: '/acquisitions/acq-1' }), params: {}, children },
    });
    // Acquisitions stays current on its [id] child route; Home does not become current.
    expect(body).toMatch(/<a href="\/acquisitions" aria-current="page"/);
    expect(body).not.toMatch(/<a href="\/" aria-current="page"/);

    // …and on an exact section match (not just a child route).
    const exact = render(Layout, {
      props: { data: data({ pathname: '/reviews' }), params: {}, children },
    });
    expect(exact.body).toMatch(/<a href="\/reviews" aria-current="page"/);
  });

  it('renders the site navigation with a count badge over the page body', () => {
    const { body } = render(Layout, {
      props: { data: data({ attentionCount: 2 }), params: {}, children },
    });
    expect(body).toContain('data-testid="site-nav"');
    expect(body).toContain('href="/acquisitions"');
    expect(body).toContain('Needs attention');
    expect(body).toContain('data-testid="attention-badge"');
    expect(body).toContain('>2<');
    expect(body).toContain('data-testid="page-body"');
  });

  it('renders no badge at all when nothing waits', () => {
    const { body } = render(Layout, { props: { data: data(), params: {}, children } });
    expect(body).toContain('Needs attention');
    expect(body).not.toContain('data-testid="attention-badge"');
  });

  it('shows who is signed in with a sign-out form posting to /logout', () => {
    const { body } = render(Layout, { props: { data: data(), params: {}, children } });
    expect(body).toMatch(/data-testid="user"[^>]*>jake</);
    expect(body).toMatch(/<form[^>]*action="\/logout"/);
    expect(body).toContain('data-testid="logout"');
  });

  it('renders signed-out chrome without navigation, request button, or sign-out (login page shell)', () => {
    const { body } = render(Layout, {
      props: { data: data({ username: undefined, pathname: '/login' }), params: {}, children },
    });
    // The wordmark and the page body stay; every signed-in affordance goes.
    expect(body).toContain('music');
    expect(body).toContain('data-testid="page-body"');
    expect(body).not.toContain('data-testid="site-nav"');
    expect(body).not.toContain('/acquisitions/new');
    expect(body).not.toContain('data-testid="logout"');
  });
});
