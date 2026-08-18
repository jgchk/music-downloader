import { createRawSnippet } from 'svelte';
import { render } from 'svelte/server';
import { describe, expect, it } from 'vitest';
import type { LayoutServerData } from './$types';
import Layout from './+layout.svelte';

const children = createRawSnippet(() => ({
  render: () => '<h1 data-testid="detail-pane">detail</h1>',
}));

/** The layout's data, over which each test varies only the fact it is about. */
function data(over: Partial<LayoutServerData> = {}) {
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
    expect(body).toContain('class="master-detail"');
    expect(body).toContain('aria-label="Acquisitions"');
    // The master pane renders the list component (its empty state here)…
    expect(body).toContain('data-testid="empty"');
    // …and the child route renders in the detail pane.
    expect(body).toContain('data-testid="detail-pane"');
    expect(body).not.toContain('data-testid="list-error"');
  });

  // The collapse hides a pane, never reorders one, and never drops the master from the document:
  // DOM order stays the reading order under every skin and with CSS off (web-ui-presentation,
  // "Accessible under every skin"). Both panes are asserted PRESENT before their order is
  // compared — `indexOf` returns -1 for a missing marker, so an order assertion alone passes
  // vacuously when the master is gone, which is exactly the regression this guards.
  it.each([[false], [true]])(
    'keeps the master present and before the detail (detail-active: %s)',
    (isDetailActive) => {
      const { body } = render(Layout, {
        props: { data: data({ detailActive: isDetailActive }), params: {}, children },
      });
      expect(body).toContain('aria-label="Acquisitions"');
      expect(body).toContain('data-testid="detail-pane"');
      expect(body.indexOf('aria-label="Acquisitions"')).toBeLessThan(
        body.indexOf('data-testid="detail-pane"'),
      );
    },
  );

  it('marks the shell as detail-active only while a child route is open', () => {
    // The exact class attribute, because it is the join with base.css's
    // `.master-detail.detail-active .master { display: none }` — the whole collapse rides on it.
    const onIndex = render(Layout, { props: { data: data(), params: {}, children } });
    expect(onIndex.body).toContain('class="master-detail"');
    expect(onIndex.body).not.toContain('detail-active');

    const onChild = render(Layout, {
      props: { data: data({ detailActive: true }), params: {}, children },
    });
    expect(onChild.body).toContain('class="master-detail detail-active"');
  });

  it('offers a way back to the queue from a child route, and only from there', () => {
    const onChild = render(Layout, {
      props: { data: data({ detailActive: true }), params: {}, children },
    });
    expect(onChild.body).toContain('data-testid="back-to-queue"');
    expect(onChild.body).toContain('Back to queue');

    const onIndex = render(Layout, { props: { data: data(), params: {}, children } });
    expect(onIndex.body).not.toContain('data-testid="back-to-queue"');
  });

  it('puts the back link at the top of the detail pane, before its content', () => {
    // GOV.UK places a back link before <main>; the pane is this layout's equivalent top.
    const { body } = render(Layout, {
      props: { data: data({ detailActive: true }), params: {}, children },
    });
    expect(body).toContain('data-testid="back-to-queue"');
    expect(body).toContain('data-testid="detail-pane"');
    expect(body.indexOf('data-testid="back-to-queue"')).toBeLessThan(
      body.indexOf('data-testid="detail-pane"'),
    );
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
