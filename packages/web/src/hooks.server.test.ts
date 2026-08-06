import { describe, expect, it, vi } from 'vitest';
import type { RequestEvent, ResolveOptions } from '@sveltejs/kit';
import { SESSION_COOKIE, SESSION_TTL_MS, signSession } from '$lib/server/session.js';

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
    cookies: { get: (name: string) => (name === SESSION_COOKIE ? cookie : undefined) },
  } as unknown as RequestEvent;
}

/** The gate REDIRECTS by throwing SvelteKit's redirect (so data requests get the JSON envelope). */
function expectLoginRedirect(run: () => unknown): void {
  expect(run).toThrow(expect.objectContaining({ status: 303, location: '/login' }));
}

/** Mint-a-cookie (design D7): tests sign with the known secret — the gate runs unmodified. */
function validCookie(now = Date.now()): string {
  return signSession(
    { plexAccountId: '42', username: 'jake', role: 'guest' },
    access.sessionSecret,
    now,
  );
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
    // The injected wall clock — the one impure edge loads read time through.
    expect(event.locals.now()).toMatch(/^\d{4}-\d{2}-\d{2}T/);
    expect(event.locals.session).toMatchObject({ plexAccountId: '42', username: 'jake' });
    expect(resolve).toHaveBeenCalledWith(event);
    expect(result).toBe(response);
  });

  it.each([
    ['no cookie', undefined],
    ['a garbage cookie', 'not-a-real-cookie'],
    [
      'a cookie signed under another secret',
      signSession({ plexAccountId: '1', username: 'x', role: 'guest' }, 'wrong-secret', Date.now()),
    ],
  ])('redirects a gated page GET with %s to the login page without resolving', (_case, cookie) => {
    const resolve = vi.fn();
    expectLoginRedirect(() => handle({ event: gateEvent('/acquisitions', { cookie }), resolve }));
    expect(resolve).not.toHaveBeenCalled();
  });

  it('logs a cookie that FAILS VERIFICATION as a tamper signal — distinct from expiry and absence', () => {
    logger.warn.mockClear();
    expectLoginRedirect(() =>
      handle({ event: gateEvent('/acquisitions', { cookie: 'forged' }), resolve: vi.fn() }),
    );
    expect(logger.warn).toHaveBeenCalledWith(
      { pathname: '/acquisitions' },
      expect.stringContaining('failed verification'),
    );

    // The routine cases stay quiet: no cookie at all, and an expired (correctly signed) cookie.
    logger.warn.mockClear();
    expectLoginRedirect(() => handle({ event: gateEvent('/acquisitions'), resolve: vi.fn() }));
    const expired = validCookie(Date.now() - SESSION_TTL_MS - 1000);
    expectLoginRedirect(() =>
      handle({ event: gateEvent('/acquisitions', { cookie: expired }), resolve: vi.fn() }),
    );
    expect(logger.warn).not.toHaveBeenCalled();
  });

  it('gates a route born under /login/ that is not the callback (exact open set, fail closed)', () => {
    const resolve = vi.fn();
    expectLoginRedirect(() => handle({ event: gateEvent('/login/future-subroute'), resolve }));
    expect(resolve).not.toHaveBeenCalled();
  });

  it('treats an expired session as unauthenticated — activity never extends it (fixed expiry)', () => {
    const resolve = vi.fn();
    const expired = validCookie(Date.now() - SESSION_TTL_MS - 1000);
    expectLoginRedirect(() => handle({ event: gateEvent('/', { cookie: expired }), resolve }));
    expect(resolve).not.toHaveBeenCalled();
  });

  it('refuses a gated non-GET (form action) without a session before any facade is invoked, leaving a trace', async () => {
    logger.warn.mockClear();
    const resolve = vi.fn();
    const response = await handle({
      event: gateEvent('/acquisitions/new', { method: 'POST' }),
      resolve,
    });
    expect(response.status).toBe(403);
    expect(resolve).not.toHaveBeenCalled();
    // An unauthenticated write attempt is an operator-visible event, not a silent bounce.
    expect(logger.warn).toHaveBeenCalledWith(
      { pathname: '/acquisitions/new', method: 'POST' },
      expect.stringContaining('refused'),
    );
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

  it('gates HEAD like GET (redirect, not refusal)', () => {
    expectLoginRedirect(() =>
      handle({ event: gateEvent('/', { method: 'HEAD' }), resolve: vi.fn() }),
    );
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
