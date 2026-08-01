import { describe, expect, it, vi } from 'vitest';
import type { RequestEvent, ResolveOptions } from '@sveltejs/kit';
import { SESSION_TTL_MS, signSession } from '$lib/server/session.js';

const bootRuntimes = vi.fn(() => Promise.resolve());
const facadesOf = vi.fn(() => ({ downloader: {}, importer: {} }));
const access = { sessionSecret: 'hook-test-secret', plex: {} };
const logger = { warn: vi.fn(), error: vi.fn() };
vi.mock('$env/dynamic/private', () => ({ env: { LIBRARY_ROOT: '/library' } }));
vi.mock('$lib/server/runtime.js', () => ({
  bootRuntimes: (...arguments_: unknown[]) => bootRuntimes(...(arguments_ as [])),
  facadesOf: () => facadesOf(),
  loggerOf: () => logger,
  accessOf: () => access,
}));

const { handle, handleError, init } = await import('./hooks.server.js');

/** A request event for the gate: URL + method + a cookie jar holding an optional session. */
function gateEvent(
  pathname: string,
  { method = 'GET', cookie }: { method?: string; cookie?: string } = {},
): RequestEvent {
  return {
    locals: {},
    url: new URL(`http://host${pathname}`),
    request: { method },
    cookies: { get: (name: string) => (name === 'md_session' ? cookie : undefined) },
  } as unknown as RequestEvent;
}

/** Mint-a-cookie (design D7): tests sign with the known secret — the gate runs unmodified. */
function validCookie(now = Date.now()): string {
  return signSession({ plexAccountId: '42', username: 'jake' }, access.sessionSecret, now);
}

describe('server hooks', () => {
  it('init boots the composed runtimes (awaited before any request is served)', async () => {
    await init();
    expect(bootRuntimes).toHaveBeenCalledOnce();
    // Boots from SvelteKit's runtime env (which carries `.env` in dev), not an empty process.env.
    expect(bootRuntimes).toHaveBeenCalledWith({ LIBRARY_ROOT: '/library' });
  });

  it('handle admits a valid session onto a gated route, injecting facades, logger, access, and the claims', async () => {
    const event = gateEvent('/acquisitions', { cookie: validCookie() });
    const response = new Response('ok');
    const resolve = vi.fn((_event: RequestEvent, _options?: ResolveOptions) =>
      Promise.resolve(response),
    );

    const result = await handle({ event, resolve });

    expect(event.locals.facades).toEqual({ downloader: {}, importer: {} });
    expect(event.locals.logger).toBe(logger);
    expect(event.locals.access).toBe(access);
    expect(event.locals.session).toMatchObject({ plexAccountId: '42', username: 'jake' });
    expect(resolve).toHaveBeenCalledWith(event);
    expect(result).toBe(response);
  });

  it.each([
    ['no cookie', undefined],
    ['a garbage cookie', 'not-a-real-cookie'],
    [
      'a cookie signed under another secret',
      signSession({ plexAccountId: '1', username: 'x' }, 'wrong-secret', Date.now()),
    ],
  ])(
    'redirects a gated page GET with %s to the login page without resolving',
    async (_case, cookie) => {
      const resolve = vi.fn();
      const response = await handle({ event: gateEvent('/acquisitions', { cookie }), resolve });
      expect(response.status).toBe(303);
      expect(response.headers.get('location')).toBe('/login');
      expect(resolve).not.toHaveBeenCalled();
    },
  );

  it('treats an expired session as unauthenticated — activity never extends it (fixed expiry)', async () => {
    const resolve = vi.fn();
    const expired = validCookie(Date.now() - SESSION_TTL_MS - 1000);
    const response = await handle({ event: gateEvent('/', { cookie: expired }), resolve });
    expect(response.status).toBe(303);
    expect(response.headers.get('location')).toBe('/login');
    expect(resolve).not.toHaveBeenCalled();
  });

  it('refuses a gated non-GET (form action) without a session before any facade is invoked', async () => {
    const resolve = vi.fn();
    const response = await handle({
      event: gateEvent('/acquisitions/new', { method: 'POST' }),
      resolve,
    });
    expect(response.status).toBe(403);
    expect(resolve).not.toHaveBeenCalled();
  });

  it.each([['/login'], ['/login/callback'], ['/health']])(
    'serves %s without any session (the open surface)',
    async (pathname) => {
      const event = gateEvent(pathname);
      const resolve = vi.fn(() => Promise.resolve(new Response('open')));
      const result = await handle({ event, resolve });
      expect(resolve).toHaveBeenCalledWith(event);
      expect(await result.text()).toBe('open');
      expect(event.locals.session).toBeUndefined();
    },
  );

  it('still verifies a session riding an open route, so the login page can bounce a signed-in user', async () => {
    const event = gateEvent('/login', { cookie: validCookie() });
    const resolve = vi.fn(() => Promise.resolve(new Response('open')));
    await handle({ event, resolve });
    expect(event.locals.session).toMatchObject({ username: 'jake' });
  });

  it('gates HEAD like GET (redirect, not refusal)', async () => {
    const resolve = vi.fn();
    const response = await handle({ event: gateEvent('/', { method: 'HEAD' }), resolve });
    expect(response.status).toBe(303);
  });

  it('handleError records the fault through the pino root with an id + request context and returns a shaped, id-carrying message', () => {
    const boom = new Error('projection read failed');
    const event = {
      route: { id: '/acquisitions/[id]' },
      request: { method: 'GET' },
    } as unknown as RequestEvent;

    const shaped = handleError({ error: boom, event, status: 500, message: 'Internal Error' }) as {
      message: string;
      errorId: string;
    };

    expect(shaped.errorId).toMatch(/\S/);
    expect(shaped.message).toContain('Internal Error');
    expect(shaped.message).toContain(shaped.errorId);
    expect(logger.error).toHaveBeenCalledOnce();
    expect(logger.error).toHaveBeenCalledWith(
      {
        errorId: shaped.errorId,
        routeId: '/acquisitions/[id]',
        method: 'GET',
        status: 500,
        err: boom,
      },
      expect.stringMatching(/\S/),
    );
  });
});
