import { render } from 'svelte/server';
import { describe, expect, it } from 'vitest';
import Landing from './Landing.svelte';

describe('Landing (SSR)', () => {
  it('renders the facade-backed counts with the request shortcut', () => {
    const { body } = render(Landing, {
      props: { counts: { acquisitions: 3, pendingReviews: 1 } },
    });
    expect(body).toContain('<h1>music</h1>');
    expect(body).toContain('href="/acquisitions/new"');
    expect(body).toContain('>3<');
    expect(body).toContain('>1<');
  });
});
