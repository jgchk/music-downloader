import { page } from 'vitest/browser';
import { describe, expect, it } from 'vitest';
import { render } from 'vitest-browser-svelte';
import Landing from './Landing.svelte';

describe('Landing', () => {
  it('shows both module counts', async () => {
    await render(Landing, {
      acquisitions: { kind: 'ok', count: 5 },
      pendingReviews: { kind: 'ok', count: 2 },
    });
    await expect.element(page.getByTestId('acquisition-count')).toHaveTextContent('5');
    await expect.element(page.getByTestId('review-count')).toHaveTextContent('2');
  });

  it('shows each unavailable section as an apology instead of its count', async () => {
    await render(Landing, {
      acquisitions: { kind: 'unavailable', message: 'Acquisitions are unavailable right now.' },
      pendingReviews: { kind: 'unavailable', message: 'Import reviews are unavailable right now.' },
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
