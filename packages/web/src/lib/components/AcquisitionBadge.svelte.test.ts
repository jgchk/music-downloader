import { page } from 'vitest/browser';
import { describe, expect, it } from 'vitest';
import { render } from 'vitest-browser-svelte';
import AcquisitionBadge from './AcquisitionBadge.svelte';

/**
 * Browser-mode component tests (real Chromium): the badge is a status indicator only. It renders
 * the label its helper returns and presents no interactive control — the failure-reason disclosure
 * it once carried is gone. The phase→label mapping itself is owned by phase-label.test.ts; here we
 * only prove that mapping is wired into the markup and that a failure surfaces no reason control.
 */
describe('AcquisitionBadge', () => {
  it('renders the label its phase helper returns', async () => {
    await render(AcquisitionBadge, { phase: 'fulfilled' });
    await expect.element(page.getByText('Done')).toBeInTheDocument();
  });

  it('presents no reason-revealing control for a failure', async () => {
    await render(AcquisitionBadge, { phase: 'failed' });
    await expect.element(page.getByText('Failed')).toBeInTheDocument();
    expect(page.getByRole('button').elements()).toHaveLength(0);
  });
});
