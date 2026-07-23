import { render } from 'svelte/server';
import { describe, expect, it } from 'vitest';
import ProgressBar from './ProgressBar.svelte';

describe('ProgressBar (SSR)', () => {
  it('renders percent and byte progress', () => {
    const { body } = render(ProgressBar, {
      props: { progress: { percent: 41.7, bytesTransferred: 1024, bytesTotal: 4096 } },
    });
    expect(body).toContain('42%');
    // The <progress> element's rounded value is the a11y contract, not just the text.
    expect(body).toContain('<progress max="100" value="42">');
    expect(body).toContain('1.0 KiB');
    expect(body).toContain('4.0 KiB');
    expect(body).not.toContain('queue position');
  });

  it('renders the queue position when present', () => {
    const { body } = render(ProgressBar, {
      props: {
        progress: { percent: 0, bytesTransferred: 0, bytesTotal: 10, queuePosition: 3 },
      },
    });
    expect(body).toContain('queue position 3');
  });
});
