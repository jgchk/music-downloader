import { describe, expect, it, vi } from 'vitest';
import { isRedirect } from '@sveltejs/kit';
import { FakePlexAccess } from '$lib/server/plex/__fixtures__/fake.js';
import { actions, load } from './+page.server.js';

function loadEvent(url: string, session?: { plexAccountId: string; username: string }) {
  return {
    locals: session === undefined ? {} : { session: { ...session, expiresAt: 1 } },
    url: new URL(url),
  } as never;
}

function actionEvent(plex: FakePlexAccess) {
  return {
    locals: {
      access: { sessionSecret: 's', plex },
      logger: { warn: vi.fn() },
    },
    url: new URL('https://music.example/login'),
  } as never;
}

describe('login page load', () => {
  it('bounces an already-signed-in user home instead of showing the door', () => {
    expect(() =>
      load(loadEvent('https://music.example/login', { plexAccountId: '1', username: 'jake' })),
    ).toThrow(expect.objectContaining({ status: 303, location: '/' }));
  });

  it('renders statically with no error when arriving fresh', () => {
    expect(load(loadEvent('https://music.example/login'))).toEqual({ error: undefined });
  });

  it.each([
    ['denied', /does not have access/],
    ['expired', /expired/],
    ['incomplete', /not completed/],
    ['unavailable', /could not be reached/],
    ['invalid', /not valid/],
  ])('renders the %s outcome as a human sentence, not a code', (code, expected) => {
    const data = load(loadEvent(`https://music.example/login?error=${code}`)) as {
      error?: string;
    };
    expect(data.error).toMatch(expected);
  });

  it('renders an unknown error code as the generic invalid message', () => {
    const data = load(loadEvent('https://music.example/login?error=wat')) as { error?: string };
    expect(data.error).toMatch(/not valid/);
  });
});

describe('login start action', () => {
  it('creates a PIN only on POST and redirects the tab to the hosted Plex auth page with the callback forward URL', async () => {
    const plex = new FakePlexAccess();
    plex.pin = { id: 55, code: 'code-55' };
    await expect(actions.default!(actionEvent(plex))).rejects.toSatisfy((thrown: unknown) => {
      if (!isRedirect(thrown)) return false;
      expect(thrown.location).toContain('https://app.plex.tv/auth#?');
      const parameters = new URLSearchParams(thrown.location.split('#?', 2)[1]);
      expect(parameters.get('code')).toBe('code-55');
      expect(parameters.get('forwardUrl')).toBe('https://music.example/login/callback?pin=55');
      return true;
    });
  });

  it('re-renders a modeled 503 when plex.tv is unreachable — never a grant, never a throw', async () => {
    const plex = new FakePlexAccess();
    plex.failCreatePin = true;
    const result = (await actions.default!(actionEvent(plex))) as {
      status: number;
      data: { error: string };
    };
    expect(result.status).toBe(503);
    expect(result.data.error).toMatch(/could not be reached/);
  });
});
