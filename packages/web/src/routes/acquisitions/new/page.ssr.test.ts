import { render } from 'svelte/server';
import { describe, expect, it } from 'vitest';
import Page from './+page.svelte';

const LAYOUT_DATA = {
  username: 'jake',
  attentionCount: 0,
  pathname: '/acquisitions/new',
  acquisitions: [],
  listFailed: false,
  selectedId: undefined,
  detailActive: true,
};

describe('new acquisition page (SSR)', () => {
  it('serves the search surface, ready for the first keystroke', () => {
    const { body } = render(Page, {
      props: { data: LAYOUT_DATA, params: {}, form: null },
    });

    expect(body).toContain('<h1>Request a download</h1>');
    expect(body).toContain('data-testid="catalog-query"');
    expect(body).toContain('data-testid="search-hint"');
  });

  it('serves a way to request without JavaScript, since the search needs it and this does not', () => {
    const { body } = render(Page, {
      props: { data: LAYOUT_DATA, params: {}, form: null },
    });

    expect(body).toContain('data-testid="native-form"');
    expect(body).toContain('name="artist"');
    expect(body).toContain('name="title"');
    expect(body).toContain('method="POST"');
  });

  it('renders a rejected submission’s message where a person will read it', () => {
    const { body } = render(Page, {
      props: {
        data: LAYOUT_DATA,
        params: {},
        form: { message: 'Invalid input: artist is required', values: { artist: '' } },
      },
    });

    expect(body).toContain('Invalid input: artist is required');
    expect(body).toContain('data-testid="form-error"');
  });
});
