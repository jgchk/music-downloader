import { describe, expect, it, vi } from 'vitest';
import { isRedirect } from '@sveltejs/kit';
import { FakePlexAccess } from '$lib/server/plex/__fixtures__/fake.js';
import { SESSION_TTL_MS, verifySession } from '$lib/server/session.js';
import { GET } from './+server.js';

const SECRET = 'callback-test-secret';

function event(
  plex: FakePlexAccess,
  query: string,
  options: { boundPin?: string | undefined } = {},
) {
  // `'in'`-check, not a destructuring default: `{ boundPin: undefined }` must mean NO cookie.
  const boundPin = 'boundPin' in options ? options.boundPin : '55';
  const jar = new Map<string, { value: string; options: Record<string, unknown> }>();
  const deleted: [string, Record<string, unknown>][] = [];
  const logger = { warn: vi.fn(), info: vi.fn() };
  return {
    event: {
      cookies: {
        get: (name: string) => (name === '__Host-md_login_pin' ? boundPin : undefined),
        set: (name: string, value: string, options: Record<string, unknown>) =>
          void jar.set(name, { value, options }),
        delete: (name: string, options: Record<string, unknown>) =>
          void deleted.push([name, options]),
      },
      locals: {
        access: { sessionSecret: SECRET, plex },
        logger,
      },
      url: new URL(`https://music.example/login/callback${query}`),
    } as never,
    jar,
    deleted,
    logger,
  };
}

async function outcome(
  plex: FakePlexAccess,
  query: string,
  options: { boundPin?: string | undefined } = {},
) {
  const { event: requestEvent, jar, deleted, logger } = event(plex, query, options);
  try {
    await GET(requestEvent);
    throw new Error('callback did not redirect');
  } catch (error) {
    if (!isRedirect(error)) throw error;
    return { location: error.location, jar, deleted, logger };
  }
}

/** No logger call may ever carry the Plex token (web-access-control: token dies with the exchange). */
function expectNoTokenLogged(
  logger: { warn: ReturnType<typeof vi.fn>; info: ReturnType<typeof vi.fn> },
  token: string,
) {
  const allCalls = [...logger.warn.mock.calls, ...logger.info.mock.calls];
  expect(JSON.stringify(allCalls)).not.toContain(token);
}

describe('login callback', () => {
  it('issues a signed session cookie and lands the member inside (approved PIN + granted membership)', async () => {
    const plex = new FakePlexAccess();
    plex.pinCheck = { kind: 'authorized', token: 'user-token-1' };
    plex.membership = {
      kind: 'granted',
      identity: { plexAccountId: '9', username: 'friend' },
      role: 'guest',
    };

    const { location, jar, deleted, logger } = await outcome(plex, '?pin=55');

    expect(location).toBe('/');
    expect(plex.seen.checkedPins).toEqual([55]);
    // The membership check ran with the token the PIN check handed over…
    expect(plex.seen.membershipTokens).toEqual(['user-token-1']);
    const cookie = jar.get('__Host-md_session')!;
    // …the cookie is verifiable by the production codec with the same secret…
    const verdict = verifySession(cookie.value, SECRET, Date.now());
    expect(verdict).toMatchObject({
      kind: 'valid',
      claims: { plexAccountId: '9', username: 'friend' },
    });
    // …carries every hardening attribute EXPLICITLY (secure must not ride a framework default)…
    expect(cookie.options).toEqual({
      path: '/',
      httpOnly: true,
      sameSite: 'lax',
      secure: true,
      maxAge: SESSION_TTL_MS / 1000,
    });
    // …never the Plex token — not in the cookie, not in any log line…
    expect(cookie.value).not.toContain('user-token-1');
    expectNoTokenLogged(logger, 'user-token-1');
    // …and the single-use PIN binding was consumed.
    expect(deleted).toEqual([['__Host-md_login_pin', { path: '/', secure: true }]]);
  });

  it.each(['owner', 'guest'] as const)(
    'mints a session carrying the %s role the membership check derived',
    async (role) => {
      const plex = new FakePlexAccess();
      plex.pinCheck = { kind: 'authorized', token: 'user-token-1' };
      plex.membership = {
        kind: 'granted',
        identity: { plexAccountId: '9', username: 'friend' },
        role,
      };

      const { jar } = await outcome(plex, '?pin=55');

      const verdict = verifySession(jar.get('__Host-md_session')!.value, SECRET, Date.now());
      expect(verdict).toMatchObject({ kind: 'valid', claims: { role } });
    },
  );

  it('refuses a PIN this browser did not start — before any plex.tv call (hijack/fixation guard)', async () => {
    // No binding at all is the benign shape (expired binding, or a lure into a fresh browser):
    // the truthful UX is "expired, try again".
    const missing = await outcome(new FakePlexAccess(), '?pin=55', { boundPin: undefined });
    expect(missing.location).toBe('/login?error=expired');

    // A DIFFERENT bound pin is the attack signal, logged with both values (pin ids, not secrets).
    const mismatched = await outcome(new FakePlexAccess(), '?pin=55', { boundPin: '999' });
    expect(mismatched.location).toBe('/login?error=invalid');
    expect(mismatched.jar.size).toBe(0);
    expect(mismatched.logger.warn).toHaveBeenCalledWith(
      { pin: '55', bound: '999' },
      expect.stringContaining('does not match'),
    );
  });

  it('makes no plex.tv call for an unbound PIN', async () => {
    const plex = new FakePlexAccess();
    await outcome(plex, '?pin=55', { boundPin: undefined });
    expect(plex.seen.checkedPins).toEqual([]);
    expect(plex.seen.membershipTokens).toEqual([]);
  });

  it('routes a denied membership back to the door with no cookie (unshared account stays outside)', async () => {
    const plex = new FakePlexAccess();
    plex.pinCheck = { kind: 'authorized', token: 'tok-x' };
    plex.membership = { kind: 'denied', username: 'stranger' };
    const { location, jar, deleted, logger } = await outcome(plex, '?pin=55');
    expect(location).toBe('/login?error=denied');
    expect(jar.size).toBe(0);
    // The binding is consumed on EVERY bound outcome, not just success — a still-live binding
    // after a denial would make the callback replayable.
    expect(deleted).toHaveLength(1);
    expectNoTokenLogged(logger, 'tok-x');
  });

  it.each([
    ['an expired PIN', { kind: 'expired' } as const, '/login?error=expired'],
    ['a not-yet-approved PIN', { kind: 'pending' } as const, '/login?error=incomplete'],
  ])('routes %s back to the door with no cookie', async (_case, pinCheck, expected) => {
    const plex = new FakePlexAccess();
    plex.pinCheck = pinCheck;
    const { location, jar, deleted } = await outcome(plex, '?pin=55');
    expect(location).toBe(expected);
    expect(jar.size).toBe(0);
    expect(deleted).toHaveLength(1);
  });

  it.each([
    ['missing', ''],
    ['non-numeric', '?pin=abc'],
    ['non-positive', '?pin=-4'],
    ['fractional', '?pin=1.5'],
  ])('rejects a %s pin parameter as invalid without calling plex.tv', async (_case, query) => {
    const plex = new FakePlexAccess();
    const { location } = await outcome(plex, query);
    expect(location).toBe('/login?error=invalid');
    expect(plex.seen.checkedPins).toEqual([]);
  });

  it('fails closed to the door when the PIN check cannot reach plex.tv', async () => {
    const plex = new FakePlexAccess();
    plex.failCheckPin = true;
    const { location, jar } = await outcome(plex, '?pin=55');
    expect(location).toBe('/login?error=unavailable');
    expect(jar.size).toBe(0);
  });

  it('fails closed to the door when the membership check cannot reach plex.tv', async () => {
    const plex = new FakePlexAccess();
    plex.failCheckMembership = true;
    const { location, jar, logger } = await outcome(plex, '?pin=55');
    expect(location).toBe('/login?error=unavailable');
    expect(jar.size).toBe(0);
    expectNoTokenLogged(logger, 'fake-token');
  });
});
