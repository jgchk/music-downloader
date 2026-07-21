import { render } from 'svelte/server';
import { describe, expect, it } from 'vitest';
import Page from './+page.svelte';

describe('new acquisition page (SSR)', () => {
  it('renders the form untouched', () => {
    const { body } = render(Page, { props: { data: {}, params: {}, form: null } });
    expect(body).toContain('<h1>Request a download</h1>');
    expect(body).toContain('data-testid="submit-form"');
  });

  it('renders a failed action with message and echoed values', () => {
    const { body } = render(Page, {
      props: {
        data: {},
        params: {},
        form: { message: 'Invalid input: mbid required', values: { kind: 'musicbrainz' } },
      },
    });
    expect(body).toContain('Invalid input: mbid required');
  });
});
