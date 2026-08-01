import { expect, test } from '@playwright/test';
import { garbageStorageState } from './auth.js';

/**
 * The gate proven from OUTSIDE the artifact (out-of-process-e2e): an unauthenticated browser and
 * a browser carrying a forged cookie both land on the login page with no gated content served,
 * while /health answers credential-less. These specs run with NO storage state (or a garbage
 * one) — the authenticated journeys live in parity.spec.ts.
 */

test.describe('access gate (no session)', () => {
  test('an unauthenticated browser lands on the login page, not the app', async ({ page }) => {
    await page.goto('/');
    await expect(page).toHaveURL(/\/login$/);
    await expect(page.getByTestId('plex-login')).toBeVisible();
    // None of the signed-in chrome leaks around the gate.
    await expect(page.getByTestId('site-nav')).not.toBeVisible();

    await page.goto('/acquisitions');
    await expect(page).toHaveURL(/\/login$/);
  });

  test('the health endpoint answers without any session', async ({ request }) => {
    const response = await request.get('/health');
    expect(response.status()).toBe(200);
    const body = (await response.json()) as { status: string; version: string };
    expect(body.status).toBe('ok');
    expect(body.version).toMatch(/^\d+\.\d+\.\d+$/);
  });
});

test.describe('access gate (forged session)', () => {
  test.use({ storageState: garbageStorageState() });

  test('a garbage cookie is a verdict, not a session: back to the login page', async ({ page }) => {
    await page.goto('/acquisitions');
    await expect(page).toHaveURL(/\/login$/);
    await expect(page.getByTestId('plex-login')).toBeVisible();
  });
});
