import { createRawSnippet } from 'svelte';
import { render } from 'svelte/server';
import { describe, expect, it } from 'vitest';
import Layout from './+layout.svelte';

const children = createRawSnippet(() => ({
  render: () => '<h1 data-testid="detail-pane">detail</h1>',
}));

/** The layout's data, over which each test varies only the fact it is about. */
function data(over: Record<string, unknown> = {}) {
  return {
    username: 'jake',
    attentionCount: 0,
    pathname: '/acquisitions',
    acquisitions: [],
    listFailed: false,
    selectedId: undefined,
    detailActive: false,
    ...over,
  };
}

describe('acquisitions master-detail layout (SSR)', () => {
  it('renders the master list beside the child detail pane', () => {
    const { body } = render(Layout, { props: { data: data(), params: {}, children } });
    expect(body).toContain('master-detail');
    expect(body).toContain('aria-label="Acquisitions"');
    // The master pane renders the list component (its empty state here)…
    expect(body).toContain('data-testid="empty"');
    // …and the child route renders in the detail pane.
    expect(body).toContain('data-testid="detail-pane"');
    expect(body).not.toContain('data-testid="list-error"');
  });

  it('puts the master before the detail in the document, whichever route is open', () => {
    // The small-screen collapse hides a pane, never reorders one: DOM order stays the reading
    // order under every skin and with CSS off (web-ui-presentation: meaningful sequence).
    for (const isDetailActive of [false, true]) {
      const { body } = render(Layout, {
        props: { data: data({ detailActive: isDetailActive }), params: {}, children },
      });
      expect(body.indexOf('aria-label="Acquisitions"')).toBeLessThan(
        body.indexOf('data-testid="detail-pane"'),
      );
    }
  });

  it('marks the shell as detail-active only while a child route is open', () => {
    const onIndex = render(Layout, { props: { data: data(), params: {}, children } });
    expect(onIndex.body).not.toContain('detail-active');

    const onChild = render(Layout, {
      props: { data: data({ detailActive: true }), params: {}, children },
    });
    expect(onChild.body).toContain('detail-active');
  });

  it('offers a way back to the queue from a child route, and only from there', () => {
    const onChild = render(Layout, {
      props: { data: data({ detailActive: true }), params: {}, children },
    });
    expect(onChild.body).toContain('data-testid="back-to-queue"');
    expect(onChild.body).toContain('Back to queue');
    // Before the detail content, so it is the first thing reached in the pane (GOV.UK back link).
    expect(onChild.body.indexOf('data-testid="back-to-queue"')).toBeLessThan(
      onChild.body.indexOf('data-testid="detail-pane"'),
    );

    const onIndex = render(Layout, { props: { data: data(), params: {}, children } });
    expect(onIndex.body).not.toContain('data-testid="back-to-queue"');
  });

  it('shows a degrade banner when the guarded list read failed', () => {
    const { body } = render(Layout, {
      props: { data: data({ listFailed: true }), params: {}, children },
    });
    expect(body).toContain('data-testid="list-error"');
    // The detail pane still renders — a list fault does not take the whole page down.
    expect(body).toContain('data-testid="detail-pane"');
  });
});
