import { render } from 'svelte/server';
import { describe, expect, it } from 'vitest';
import type { AttentionItem } from '$lib/attention.js';
import AttentionQueue from './AttentionQueue.svelte';

const reviewItem: AttentionItem = {
  module: 'importer',
  kind: 'match-review',
  id: 'imp-1',
  title: '/intake/album',
  href: '/reviews/imp-1',
};

const editionItem: AttentionItem = {
  module: 'downloader',
  kind: 'edition-selection',
  id: 'acq-1',
  title: 'OK Computer — awaiting your edition choice',
  href: '/acquisitions/acq-1',
};

describe('AttentionQueue (SSR)', () => {
  it('renders the empty state when nothing waits and no section failed', () => {
    const { body } = render(AttentionQueue, { props: { items: [] } });
    expect(body).toContain('data-testid="empty"');
  });

  it('renders one ordered list with module and kind labels and resolution links', () => {
    const { body } = render(AttentionQueue, { props: { items: [reviewItem, editionItem] } });
    expect(body).toContain('href="/reviews/imp-1"');
    expect(body).toContain('href="/acquisitions/acq-1"');
    expect(body).toContain('Importer');
    expect(body).toContain('Match review');
    expect(body).toContain('Downloader');
    expect(body).toContain('Edition selection');
    expect(body.indexOf('/reviews/imp-1')).toBeLessThan(body.indexOf('/acquisitions/acq-1'));
  });

  it('notes when an item has been waiting, only for dated items', () => {
    const dated = { ...reviewItem, waitingSince: '2026-07-01T00:00:00Z' };
    const { body } = render(AttentionQueue, { props: { items: [dated, editionItem] } });
    expect(body.match(/data-testid="waiting-since"/g)).toHaveLength(1);
    expect(body).toContain('2026-07-01T00:00:00Z');
  });

  it('renders a section error note alongside the other module’s items, not an empty marker', () => {
    const { body } = render(AttentionQueue, {
      props: {
        items: [editionItem],
        errors: { importer: 'Import reviews are unavailable right now.' },
      },
    });
    expect(body).toContain('data-testid="section-error-importer"');
    expect(body).toContain('Import reviews are unavailable right now.');
    expect(body).toContain('href="/acquisitions/acq-1"');
    expect(body).not.toContain('data-testid="empty"');
  });

  it('suppresses the empty marker when a failed section may be hiding items', () => {
    const { body } = render(AttentionQueue, {
      props: { items: [], errors: { downloader: 'Acquisitions are unavailable right now.' } },
    });
    expect(body).toContain('data-testid="section-error-downloader"');
    expect(body).not.toContain('data-testid="empty"');
  });
});
