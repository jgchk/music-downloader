import { render } from 'svelte/server';
import { describe, expect, it } from 'vitest';
import AcquisitionBadge from './AcquisitionBadge.svelte';

/**
 * SSR smokes: the component renders to HTML on the server exactly as the BFF will serve it —
 * no browser, no hydration, just the server render path the real app takes first. Every
 * server-renderable state is exercised here; interaction (toggling) belongs to the client project.
 */
describe('AcquisitionBadge (SSR)', () => {
  it('renders the phase label', () => {
    const { body } = render(AcquisitionBadge, { props: { phase: 'fulfilled' } });
    expect(body).toContain('Done');
    expect(body).not.toContain('<button');
  });

  it('renders the reasons affordance for failures', () => {
    const { body } = render(AcquisitionBadge, {
      props: { phase: 'failed', reasons: ['no match'] },
    });
    expect(body).toContain('Failed');
    expect(body).toContain('Show reasons');
  });

  it('server-renders an initially expanded reasons list', () => {
    const { body } = render(AcquisitionBadge, {
      props: { phase: 'failed', reasons: ['no match', 'timeout'], initiallyExpanded: true },
    });
    expect(body).toContain('Hide reasons');
    expect(body).toContain('no match');
    expect(body).toContain('timeout');
  });

  it('server-renders the empty-reasons fallback when initially expanded', () => {
    const { body } = render(AcquisitionBadge, {
      props: { phase: 'failed', initiallyExpanded: true },
    });
    expect(body).toContain('No reasons given');
  });
});
