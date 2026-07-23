import { expect, test, type Page } from '@playwright/test';

/**
 * Switch the request kind to `descriptor` and wait for its reactive fields. A selectOption that
 * fires before hydration changes only the DOM: Svelte then reasserts its own state (`bind:value`),
 * the select snaps back, and the descriptor fields never render. Re-select until they appear.
 */
async function chooseDescriptorKind(page: Page): Promise<void> {
  await expect(async () => {
    await page.getByTestId('kind').selectOption('descriptor');
    await expect(page.getByTestId('artist')).toBeVisible({ timeout: 1000 });
  }).toPass({ timeout: 10_000 });
}

/**
 * BOOT SMOKE ONLY — this file is NOT the a11y/layout "parity" suite its name might suggest.
 *
 * What it is: the out-of-process-e2e browser phase driving the real composed app — daemon booted by
 * the init hook, real facades, real stores — as a user would, in either of the two modes
 * playwright.config.ts describes (the built image under test/e2e/run.sh in CI; a serve.sh boot
 * locally). It proves the app boots, serves its core surfaces, and round-trips a submit/cancel.
 * Third parties (slskd, MusicBrainz) point at a port fetch refuses deterministically, so
 * acquisitions retry/park rather than fulfil; the full download→import loop belongs to the tier's
 * loop phases (1–2), not this smoke.
 *
 * What it deliberately is NOT (deferred): the presentation "parity" invariants the swappable-skin
 * design promises — keyboard tab-order equivalence, the semantic skeleton surviving CSS-off, and
 * per-skin layout invariants. Those belong in a dedicated a11y-parity spec that does not yet exist;
 * do not read this file's green as evidence of them. Keep new heavy per-skin/a11y specs out of here.
 */

test.describe('composed app boot smoke (not a11y/layout parity — deferred)', () => {
  test('boots and serves the site navigation with every surface from the landing page', async ({
    page,
  }) => {
    await page.goto('/');
    await expect(page.getByRole('link', { name: 'Home' })).toBeVisible();
    await expect(page.getByRole('link', { name: 'Acquisitions' })).toBeVisible();
    await expect(page.getByRole('link', { name: /Needs attention/ })).toBeVisible();
  });

  test('serves a submitted acquisition onto its detail and into the list', async ({ page }) => {
    await page.goto('/acquisitions/new');
    await chooseDescriptorKind(page);
    await page.getByTestId('artist').fill('E2E Artist');
    await page.locator('input[name="title"]').fill('E2E Album');
    await page.getByRole('button', { name: 'Request download' }).click();

    await expect(page).toHaveURL(/\/acquisitions\/[^/]+$/);
    await expect(page.getByTestId('status')).toBeVisible();

    await page.goto('/acquisitions');
    await expect(page.getByText('E2E Artist — E2E Album')).toBeVisible();
  });

  test('serves a rejected submission back as the form with its failure message', async ({
    page,
  }) => {
    await page.goto('/acquisitions/new');
    // MusicBrainz kind with no MBID: the facade's zod boundary refuses it.
    await page.getByRole('button', { name: 'Request download' }).click();
    await expect(page.getByTestId('form-error')).toBeVisible();
    await expect(page.getByTestId('submit-form')).toBeVisible();
  });

  test('serves a cancel from a cancellable acquisition detail page', async ({ page }) => {
    await page.goto('/acquisitions/new');
    await chooseDescriptorKind(page);
    await page.getByTestId('artist').fill('Cancel Me');
    await page.locator('input[name="title"]').fill('Now');
    await page.getByRole('button', { name: 'Request download' }).click();
    await expect(page).toHaveURL(/\/acquisitions\/[^/]+$/);

    // With third parties unreachable the acquisition retries with backoff, so it stays
    // cancellable long enough for a user-shaped cancel.
    const cancel = page.getByTestId('cancel');
    await expect(cancel).toBeVisible();
    await cancel.click();
    await expect(page.getByTestId('status')).toHaveText('Cancelled');
  });

  test('serves the review queue empty state', async ({ page }) => {
    await page.goto('/reviews');
    await expect(page.getByTestId('empty')).toBeVisible();
  });
});
