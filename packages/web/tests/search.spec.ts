import { expect, test } from '@playwright/test';
import { authenticatedStorageState } from './auth.js';

test.use({ storageState: authenticatedStorageState() });

/**
 * The request page's search surface, driven through the real composed app.
 *
 * This tier points MusicBrainz at a port that refuses deterministically, so what it can prove here
 * is precisely the half that matters most and is hardest to fake: the page serves its pre-search
 * state, a search that cannot reach the catalog says so as a FAULT rather than as "nothing
 * matched", and the artwork endpoint answers for itself. The catalog-answering half — ranking,
 * intent order, editions, the system's default — is proven against recorded provider bytes in the
 * contract tier and against a stubbed catalog in the component tier, where it can be asserted
 * exactly rather than sampled through a live third party.
 */

test.describe('request page search', () => {
  test('serves the search box and what to do with it, before anything is typed', async ({
    page,
  }) => {
    await page.goto('/acquisitions/new');

    await expect(page.getByTestId('catalog-query')).toBeVisible();
    await expect(page.getByTestId('search-hint')).toBeVisible();
    await expect(page.getByTestId('search-hint')).toContainText('MusicBrainz ID');
  });

  test('reports a catalog it cannot reach as a fault, not as an empty result', async ({ page }) => {
    await page.goto('/acquisitions/new');

    // Retried until hydration has taken over the input: before it, typing changes only the DOM.
    await expect(async () => {
      await page.getByTestId('catalog-query').fill('paul simon graceland');
      await page.getByTestId('catalog-query').press('Enter');
      await expect(page.getByTestId('search-error')).toBeVisible({ timeout: 2000 });
    }).toPass({ timeout: 20_000 });

    await expect(page.getByTestId('no-matches')).toHaveCount(0);
  });

  test('answers for artwork itself rather than sending the browser to a third party', async ({
    page,
    request,
  }) => {
    await page.goto('/acquisitions/new');

    // The archive is unreachable in this tier, so the endpoint's own answer is what is asserted:
    // it responds, from this application, without the page ever naming a third-party host.
    const response = await request.get(
      '/cover-art/release-group/19847822-1430-3380-9cf1-bc45545b34ac?size=250',
    );

    expect([200, 404, 502]).toContain(response.status());
    expect(await page.content()).not.toContain('coverartarchive.org');
  });

  test('refuses an identifier that is not a catalog id without asking anyone', async ({
    request,
  }) => {
    const response = await request.get('/cover-art/release-group/not-an-mbid');

    expect(response.status()).toBe(400);
  });
});
