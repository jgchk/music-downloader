import { describe, expect, it, vi } from 'vitest';
import { isRedirect } from '@sveltejs/kit';
import { FakePlexAccess } from '$lib/server/plex/__fixtures__/fake.js';
import { SESSION_TTL_MS, verifySession } from '$lib/server/session.js';
import { GET } from './+server.js';

const SECRET = 'callback-test-secret';

function event(plex: FakePlexAccess, query: string) {
  const jar = new Map<string, { value: string; options: Record<string, unknown> }>();
  return {
    event: {
      cookies: {
        set: (name: string, value: string, options: Record<string, unknown>) =>
          void jar.set(name, { value, options }),
      },
      locals: {
        access: { sessionSecret: SECRET, plex },
        logger: { warn: vi.fn(), info: vi.fn() },
      },
      url: new URL(`https://music.example/login/callback${query}`),
    } as never,
    jar,
  };
}

async function outcome(plex: FakePlexAccess, query: string) {
  const { event: requestEvent, jar } = event(plex, query);
  try {
    await GET(requestEvent);
    throw new Error('callback did not redirect');
  } catch (error) {
    if (!isRedirect(error)) throw error;
    return { location: error.location, jar };
  }
}

describe('login callback', () => {
  it('issues a signed session cookie and lands the member inside (approved PIN + granted membership)', async () => {
    const plex = new FakePlexAccess();
    plex.pinCheck = { kind: 'authorized', token: 'user-token-1' };
    plex.membership = { kind: 'granted', identity: { plexAccountId: '9', username: 'friend' } };

    const { location, jar } = await outcome(plex, '?pin=55');

    expect(location).toBe('/');
    expect(plex.seen.checkedPins).toEqual([55]);
    // The membership check ran with the token the PIN check handed over…
    expect(plex.seen.membershipTokens).toEqual(['user-token-1']);
    const cookie = jar.get('md_session')!;
    // …the cookie is verifiable by the production codec with the same secret…
    const verdict = verifySession(cookie.value, SECRET, Date.now());
    expect(verdict).toMatchObject({
      kind: 'valid',
      claims: { plexAccountId: '9', username: 'friend' },
    });
    // …carries the hardening attributes, and never the Plex token.
    expect(cookie.options).toMatchObject({
      path: '/',
      httpOnly: true,
      sameSite: 'lax',
      maxAge: SESSION_TTL_MS / 1000,
    });
    expect(cookie.value).not.toContain('user-token-1');
  });

  it('routes a denied membership back to the door with no cookie (unshared account stays outside)', async () => {
    const plex = new FakePlexAccess();
    plex.membership = { kind: 'denied', username: 'stranger' };
    const { location, jar } = await outcome(plex, '?pin=55');
    expect(location).toBe('/login?error=denied');
    expect(jar.size).toBe(0);
  });

  it.each([
    ['an expired PIN', { kind: 'expired' } as const, '/login?error=expired'],
    ['a not-yet-approved PIN', { kind: 'pending' } as const, '/login?error=incomplete'],
  ])('routes %s back to the door with no cookie', async (_case, pinCheck, expected) => {
    const plex = new FakePlexAccess();
    plex.pinCheck = pinCheck;
    const { location, jar } = await outcome(plex, '?pin=55');
    expect(location).toBe(expected);
    expect(jar.size).toBe(0);
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
    const { location, jar } = await outcome(plex, '?pin=55');
    expect(location).toBe('/login?error=unavailable');
    expect(jar.size).toBe(0);
  });
});
