import { page } from 'vitest/browser';
import { describe, expect, it } from 'vitest';
import { render } from 'vitest-browser-svelte';
import Landing from './Landing.svelte';

describe('Landing', () => {
  it('shows both module counts', async () => {
    await render(Landing, { counts: { acquisitions: 5, pendingReviews: 2 } });
    await expect.element(page.getByTestId('acquisition-count')).toHaveTextContent('5');
    await expect.element(page.getByTestId('review-count')).toHaveTextContent('2');
  });

  it('shows each degraded section as an apology instead of its count', async () => {
    await render(Landing, {
      counts: { acquisitions: 0, pendingReviews: 0 },
      errors: {
        acquisitions: 'Acquisitions are unavailable right now.',
        pendingReviews: 'Import reviews are unavailable right now.',
      },
    });
    await expect
      .element(page.getByTestId('acquisition-error'))
      .toHaveTextContent('Acquisitions are unavailable right now.');
    await expect
      .element(page.getByTestId('review-error'))
      .toHaveTextContent('Import reviews are unavailable right now.');
    expect(page.getByTestId('acquisition-count').query()).toBeNull();
    expect(page.getByTestId('review-count').query()).toBeNull();
  });
});
