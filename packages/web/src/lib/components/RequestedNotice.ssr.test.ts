import { render } from 'svelte/server';
import { describe, expect, it } from 'vitest';
import RequestedNotice from './RequestedNotice.svelte';

describe('RequestedNotice (SSR)', () => {
  it('names what was requested, and a way to open it', () => {
    const { body } = render(RequestedNotice, {
      props: { requested: { acquisitionId: 'acq-9', title: 'Graceland' } },
    });

    // A page of identical "Requested" lines says which button was pressed only by where it sits.
    expect(body).toContain('Requested Graceland');
    expect(body).toContain('/acquisitions/acq-9');
  });

  it('still confirms when nothing named it', () => {
    const { body } = render(RequestedNotice, { props: { requested: { acquisitionId: 'acq-9' } } });

    expect(body).toContain('Requested');
    expect(body).toContain('/acquisitions/acq-9');
  });

  it('says nothing at all until something has been requested', () => {
    const { body } = render(RequestedNotice, { props: { requested: undefined } });

    expect(body).not.toContain('Requested');
  });
});
