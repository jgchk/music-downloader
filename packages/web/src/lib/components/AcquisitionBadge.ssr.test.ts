import { render } from 'svelte/server';
import { describe, expect, it } from 'vitest';
import AcquisitionBadge from './AcquisitionBadge.svelte';

/**
 * SSR smokes: the component renders to HTML on the server exactly as the BFF will serve it —
 * no browser, no hydration. The badge is a status indicator only, so it server-renders a phase
 * label and no interactive control.
 */
describe('AcquisitionBadge (SSR)', () => {
  it('renders the phase label with no control', () => {
    const { body } = render(AcquisitionBadge, { props: { phase: 'fulfilled' } });
    expect(body).toContain('Done');
    expect(body).not.toContain('<button');
  });

  it('renders no control for a failure', () => {
    const { body } = render(AcquisitionBadge, { props: { phase: 'failed' } });
    expect(body).toContain('Failed');
    expect(body).not.toContain('<button');
  });
});
