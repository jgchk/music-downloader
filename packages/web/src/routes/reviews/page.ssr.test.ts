import { render } from 'svelte/server';
import { describe, expect, it } from 'vitest';
import Page from './+page.svelte';

describe('attention queue page (SSR)', () => {
  it('renders the retitled queue over its load data', () => {
    const { body } = render(Page, {
      props: {
        data: {
          attentionCount: 0,
          items: [],
          errors: { importer: undefined, downloader: undefined },
        },
        params: {},
        form: null,
      },
    });
    expect(body).toContain('<h1>Needs attention</h1>');
    expect(body).toContain('data-testid="empty"');
  });

  it('hands the load’s section errors through to the queue', () => {
    const { body } = render(Page, {
      props: {
        data: {
          attentionCount: 0,
          items: [],
          errors: { importer: 'Import reviews are unavailable right now.', downloader: undefined },
        },
        params: {},
        form: null,
      },
    });
    expect(body).toContain('data-testid="section-error-importer"');
    expect(body).not.toContain('data-testid="empty"');
  });
});
