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
});
