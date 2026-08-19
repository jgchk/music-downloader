import { render } from 'svelte/server';
import { describe, expect, it } from 'vitest';
import RequestRefusal from './RequestRefusal.svelte';

describe('RequestRefusal (SSR)', () => {
  it('says why the request was refused, in the words it was refused with', () => {
    const { body } = render(RequestRefusal, {
      props: { refused: 'That acquisition already exists.' },
    });

    expect(body).toContain('That acquisition already exists.');
    expect(body).toContain('role="alert"');
  });

  it('says nothing at all while nothing has been refused', () => {
    const { body } = render(RequestRefusal, { props: { refused: undefined } });

    expect(body).not.toContain('role="alert"');
  });
});
