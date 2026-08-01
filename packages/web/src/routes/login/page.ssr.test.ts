import { render } from 'svelte/server';
import { describe, expect, it } from 'vitest';
import Page from './+page.svelte';

function pageProperties(data: { error?: string }, form: { error?: string } | null = null) {
  return { data, form, params: {} } as never;
}

describe('login page (SSR)', () => {
  it('renders the door: one POST form whose button starts the Plex sign-in', () => {
    const { body } = render(Page, { props: pageProperties({}) });
    expect(body).toContain('data-testid="login"');
    expect(body).toMatch(/<form method="POST"/);
    expect(body).toContain('data-testid="plex-login"');
    expect(body).toContain('Sign in with Plex');
    expect(body).not.toContain('data-testid="login-error"');
  });

  it('renders a callback outcome message as an alert', () => {
    const { body } = render(Page, {
      props: pageProperties({ error: 'Your Plex account does not have access to this server.' }),
    });
    expect(body).toMatch(/role="alert"/);
    expect(body).toContain('does not have access');
  });

  it('prefers the action failure (plex.tv down on POST) over a stale query message', () => {
    const { body } = render(Page, {
      props: pageProperties({ error: 'old message' }, { error: 'Plex could not be reached' }),
    });
    expect(body).toContain('Plex could not be reached');
    expect(body).not.toContain('old message');
  });
});
