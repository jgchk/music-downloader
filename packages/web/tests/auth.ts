import { SESSION_COOKIE, SESSION_TTL_MS, signSession } from '../src/lib/server/session.js';

/**
 * Mint-a-cookie for the browser phase (web-access-control design D7, out-of-process-e2e): the
 * harness signs a session with the PRODUCTION codec — imported, never reimplemented — under the
 * throwaway secret run.sh (or serve.sh) handed the app, and installs it via Playwright's blessed
 * storage-state mechanism. The gate in the tested artifact runs exactly as shipped; there is no
 * auth-disabling configuration to lean on.
 */

const SECRET = process.env['E2E_SESSION_SECRET'] ?? 'e2e-session-secret-0123456789abcdef';
const BASE_URL = process.env['E2E_BASE_URL'] || 'http://localhost:4173';

type StorageState = {
  cookies: {
    name: string;
    value: string;
    domain: string;
    path: string;
    expires: number;
    httpOnly: boolean;
    secure: boolean;
    sameSite: 'Lax';
  }[];
  origins: [];
};

export function authenticatedStorageState(): StorageState {
  const url = new URL(BASE_URL);
  return {
    cookies: [
      {
        name: SESSION_COOKIE,
        // The browser phase stands in for the server's owner (see test/e2e/helpers.ts).
        value: signSession(
          { plexAccountId: 'e2e', username: 'e2e-browser', role: 'owner' },
          SECRET,
          Date.now(),
        ),
        domain: url.hostname,
        path: '/',
        expires: Math.floor((Date.now() + SESSION_TTL_MS) / 1000),
        httpOnly: true,
        // __Host--prefixed cookies must be Secure; browsers still send them on localhost http.
        secure: true,
        sameSite: 'Lax',
      },
    ],
    origins: [],
  };
}

/** A cookie the codec must refuse: same shape, garbage signature. */
export function garbageStorageState(): StorageState {
  const state = authenticatedStorageState();
  return {
    ...state,
    cookies: state.cookies.map((cookie) => ({ ...cookie, value: 'not-a-signed-session' })),
  };
}
