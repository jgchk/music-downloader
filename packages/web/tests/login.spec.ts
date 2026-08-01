import { expect, test } from '@playwright/test';

/**
 * The login journey against the harness's plex.tv stub (out-of-process-e2e): the app's REAL login
 * routes run end to end — form POST creates a PIN against the stub, the redirect contract to
 * Plex's hosted page is asserted (the one hop that isn't our code is simulated by following its
 * forwardUrl), and the callback checks the PIN, runs the membership check, and issues a real
 * session. Only the harness (test/e2e/run.sh phase 0) points PLEX_API_BASE_URL at the stub — the
 * local serve.sh mode has no stub, so these skip there.
 */

const stubbed = Boolean(process.env['E2E_PLEX_STUB']);

test.describe('login journey (plex.tv stubbed)', () => {
  test.skip(!stubbed, 'needs the harness plex.tv stub (test/e2e/run.sh phase 0)');

  test('a member walks form → Plex redirect contract → callback → issued session → gated app', async ({
    page,
  }) => {
    // The tab must never actually leave for plex.tv: serve a placeholder for the hosted page.
    await page.route('https://app.plex.tv/**', (route) =>
      route.fulfill({
        status: 200,
        contentType: 'text/html',
        body: '<html><body>plex hosted auth (stubbed)</body></html>',
      }),
    );

    await page.goto('/login');
    await page.getByTestId('plex-login').click();
    await page.waitForURL(/app\.plex\.tv/);

    // The redirect contract (design D3): fragment query carrying our client id, the stub's PIN
    // code, and a forwardUrl back to the callback with the PIN id.
    const fragment = new URLSearchParams(new URL(page.url()).hash.slice(2));
    expect(fragment.get('clientID')).toBe('music-downloader-web');
    expect(fragment.get('code')).toBe('e2e-pin-code');
    const forwardUrl = fragment.get('forwardUrl');
    expect(forwardUrl).toContain('/login/callback?pin=4242');

    // Simulate Plex's bounce: follow the forwardUrl the app published.
    await page.goto(forwardUrl!);
    await expect(page).toHaveURL(/\/$/);
    await expect(page.getByTestId('site-nav')).toBeVisible();
    await expect(page.getByTestId('user')).toHaveText('e2euser');

    // The issued session is a real one: a fresh gated page renders without any re-login.
    await page.goto('/acquisitions');
    await expect(page).toHaveURL(/\/acquisitions$/);
  });

  test('an account without the server is denied and stays outside', async ({
    context,
    page,
    baseURL,
  }) => {
    // A browser that STARTED this login (the binding cookie) whose account turns out unshared —
    // going straight to the callback stands in for the app.plex.tv bounce.
    await context.addCookies([
      {
        name: '__Host-md_login_pin',
        value: '5555',
        domain: new URL(baseURL!).hostname,
        path: '/',
        httpOnly: true,
        secure: true,
        sameSite: 'Lax',
      },
    ]);
    await page.goto('/login/callback?pin=5555');
    await expect(page).toHaveURL(/\/login\?error=denied/);
    await expect(page.getByTestId('login-error')).toContainText('does not have access');

    await page.goto('/acquisitions');
    await expect(page).toHaveURL(/\/login$/);
  });

  test('a callback for a PIN this browser did not start is refused before any plex.tv exchange', async ({
    page,
  }) => {
    // No binding cookie: the guessable-pin hijack / login-fixation vector is refused (the benign
    // reading of "no binding" is an expired one, so that is the message shown).
    await page.goto('/login/callback?pin=4242');
    await expect(page).toHaveURL(/\/login\?error=expired/);
    await expect(page.getByTestId('login-error')).toBeVisible();
  });
});
