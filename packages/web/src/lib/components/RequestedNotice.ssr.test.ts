import { render } from 'svelte/server';
import { describe, expect, it } from 'vitest';
import RequestedNotice from './RequestedNotice.svelte';

describe('RequestedNotice (SSR)', () => {
  it('names a way to open what was just requested', () => {
    const { body } = render(RequestedNotice, { props: { requested: { acquisitionId: 'acq-9' } } });

    expect(body).toContain('Requested');
    expect(body).toContain('/acquisitions/acq-9');
  });

  it('says nothing at all until something has been requested', () => {
    const { body } = render(RequestedNotice, { props: { requested: undefined } });

    expect(body).not.toContain('Requested');
  });
});
