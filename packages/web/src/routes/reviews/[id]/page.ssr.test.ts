import { render } from 'svelte/server';
import { describe, expect, it } from 'vitest';
import Page from './+page.svelte';

describe('review detail page (SSR)', () => {
  it('renders the review over its load data with an action failure', () => {
    const { body } = render(Page, {
      props: {
        data: {
          attentionCount: 0,
          pathname: '/reviews/imp-1',
          pending: { importId: 'imp-1', path: '/intake/x', review: { kind: 'no-match' } },
        },
        params: { id: 'imp-1' },
        form: { message: 'This review has already been settled.' },
      },
    });
    expect(body).toContain('data-testid="no-match-note"');
    expect(body).toContain('data-testid="action-error"');
  });
});
