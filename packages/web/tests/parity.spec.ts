import { expect, test } from '@playwright/test';

/**
 * The parity smoke (web-ui 6.5): the real composed app — daemon booted by the init hook, real
 * facades, real stores on a scratch filesystem — driven as a user would. Third parties (slskd,
 * MusicBrainz) point at a closed port, so acquisitions retry/park rather than fulfil; the full
 * download→import loop is the out-of-process e2e tier's job (group 8), not this smoke's.
 */

test('the landing page offers the product navigation', async ({ page }) => {
  await page.goto('/');
  await expect(page.getByRole('link', { name: 'Acquisitions' })).toBeVisible();
  await expect(page.getByRole('link', { name: 'Reviews' })).toBeVisible();
});

test('submitting an acquisition lands on its detail and appears in the list', async ({ page }) => {
  await page.goto('/acquisitions/new');
  await page.getByTestId('kind').selectOption('descriptor');
  await page.getByTestId('artist').fill('E2E Artist');
  await page.locator('input[name="title"]').fill('E2E Album');
  await page.getByRole('button', { name: 'Request download' }).click();

  await expect(page).toHaveURL(/\/acquisitions\/[^/]+$/);
  await expect(page.getByTestId('status')).toBeVisible();

  await page.goto('/acquisitions');
  await expect(page.getByText('E2E Artist — E2E Album')).toBeVisible();
});

test('a rejected submission re-renders the form with the failure message', async ({ page }) => {
  await page.goto('/acquisitions/new');
  // MusicBrainz kind with no MBID: the facade's zod boundary refuses it.
  await page.getByRole('button', { name: 'Request download' }).click();
  await expect(page.getByTestId('form-error')).toBeVisible();
  await expect(page.getByTestId('submit-form')).toBeVisible();
});

test('a cancellable acquisition can be cancelled from its detail page', async ({ page }) => {
  await page.goto('/acquisitions/new');
  await page.getByTestId('kind').selectOption('descriptor');
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

test('the review queue serves its empty state', async ({ page }) => {
  await page.goto('/reviews');
  await expect(page.getByTestId('empty')).toBeVisible();
});
