import { render } from 'svelte/server';
import { describe, expect, it } from 'vitest';
import Page from './+page.svelte';

describe('acquisition detail page (SSR)', () => {
  it('renders the detail view over its load data with an action failure', () => {
    const { body } = render(Page, {
      props: {
        data: {
          attentionCount: 0,
          list: { acquisitions: [] },
          selectedId: 'acq-1',
          acquisition: {
            acquisitionId: 'acq-1',
            status: 'Searching',
            attempts: 0,
            rejectedCount: 0,
            history: [],
          },
          progress: undefined,
          progressUnavailable: false,
        },
        params: { id: 'acq-1' },
        form: { message: 'The record changed while you were working - reload and try again.' },
      },
    });
    expect(body).toContain('data-testid="status"');
    expect(body).toContain('data-testid="action-error"');
  });
});
