import { expect, test, type Page } from '@playwright/test';
import { authenticatedStorageState } from './auth.js';

// Every journey here runs signed-in via a harness-minted session (the production codec under the
// harness secret — web-access-control design D7). The gate itself is proven in gate.spec.ts.
test.use({ storageState: authenticatedStorageState() });

/**
 * Open the request page's artist-and-title form — the path that needs no catalog and no
 * JavaScript, which is what makes it the right one for a boot smoke: this tier points MusicBrainz
 * at a port that refuses, so searching cannot produce a result to request here.
 */
async function openNativeRequest(page: Page): Promise<void> {
  await expect(async () => {
    await page.getByText('Request by artist and title').click();
    await expect(page.getByTestId('native-artist')).toBeVisible({ timeout: 1000 });
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
    await openNativeRequest(page);
    await page.getByTestId('native-artist').fill('E2E Artist');
    await page.getByTestId('native-title').fill('E2E Album');
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
    await openNativeRequest(page);
    // A descriptor request naming neither artist nor title: the facade's zod boundary refuses it.
    await page.getByRole('button', { name: 'Request download' }).click();
    await expect(page.getByTestId('form-error')).toBeVisible();
    await expect(page.getByTestId('catalog-query')).toBeVisible();
  });

  test('serves a cancel from a cancellable acquisition detail page', async ({ page }) => {
    await page.goto('/acquisitions/new');
    await openNativeRequest(page);
    await page.getByTestId('native-artist').fill('Cancel Me');
    await page.getByTestId('native-title').fill('Now');
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

  test('signing out ends the session for real: gated pages bounce to the door afterwards', async ({
    page,
  }) => {
    await page.goto('/');
    await page.getByTestId('logout').click();
    await expect(page).toHaveURL(/\/login$/);
    // The cleared cookie is gone, not just the page changed: a fresh gated navigation stays out.
    await page.goto('/acquisitions');
    await expect(page).toHaveURL(/\/login$/);
  });
});
