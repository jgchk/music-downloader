import { page } from 'vitest/browser';
import { describe, expect, it } from 'vitest';
import { render } from 'vitest-browser-svelte';
import AcquisitionBadge from './AcquisitionBadge.svelte';

/**
 * Browser-mode component tests (real Chromium): every template branch of the spike component —
 * phase labels, the failed-only affordance, expand/collapse, the reasons list and its empty
 * fallback — driven through locators with built-in retry.
 */
describe('AcquisitionBadge', () => {
  it('shows the working label while pending, with no reasons affordance', async () => {
    await render(AcquisitionBadge, { phase: 'pending' });
    await expect.element(page.getByText('Working')).toBeInTheDocument();
    expect(page.getByRole('button').elements()).toHaveLength(0);
  });

  it('shows the done label when fulfilled', async () => {
    await render(AcquisitionBadge, { phase: 'fulfilled' });
    await expect.element(page.getByText('Done')).toBeInTheDocument();
  });

  it('expands and collapses the failure reasons', async () => {
    await render(AcquisitionBadge, { phase: 'failed', reasons: ['no candidate', 'timeout'] });
    await expect.element(page.getByRole('button')).toHaveTextContent('Show reasons');

    await page.getByRole('button').click();
    await expect.element(page.getByRole('button')).toHaveTextContent('Hide reasons');
    await expect.element(page.getByText('no candidate')).toBeInTheDocument();
    await expect.element(page.getByText('timeout')).toBeInTheDocument();

    await page.getByRole('button').click();
    await expect.element(page.getByRole('button')).toHaveTextContent('Show reasons');
    expect(page.getByText('no candidate').elements()).toHaveLength(0);
  });

  it('falls back when a failure carries no reasons', async () => {
    await render(AcquisitionBadge, { phase: 'failed' });
    await page.getByRole('button').click();
    await expect.element(page.getByText('No reasons given')).toBeInTheDocument();
  });
});
