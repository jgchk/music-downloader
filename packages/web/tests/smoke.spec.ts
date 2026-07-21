import { expect, test } from '@playwright/test';

test('the landing page serves', async ({ page }) => {
  await page.goto('/');
  await expect(page.getByRole('heading', { level: 1 })).toBeVisible();
});
