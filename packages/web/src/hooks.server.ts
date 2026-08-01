import type { Handle, HandleServerError, ServerInit } from '@sveltejs/kit';
import { env } from '$env/dynamic/private';
import { accessOf, bootRuntimes, facadesOf, loggerOf } from '$lib/server/runtime.js';
import { SESSION_COOKIE, verifySession } from '$lib/server/session.js';

/**
 * The composed process's server hooks (design D8): `init` boots both module runtimes and the
 * seam subscriptions — SvelteKit awaits it before serving any request, which is exactly the
 * runtime-baseline guarantee ("module runtimes start before the interface accepts work") — and
 * `handle` exposes the module facades to every server route via locals. Routes see facades only;
 * the daemon lives behind $lib/server.
 */
export const init: ServerInit = async () => {
  // Boot from SvelteKit's runtime env, not process.env: in dev, vite/SvelteKit loads `.env`
  // into `$env/dynamic/private` (and NOT into process.env), so the composed config surface is
  // only visible here. Under adapter-node in production this reflects the real process env.
  await bootRuntimes(env);
};

/**
 * The routes that answer without a session (web-access-control): the login flow — a user must be
 * able to reach the door — and the health probe, which deploy verification and monitoring hit
 * credential-less. Everything else requires a valid session cookie.
 */
function isOpenRoute(pathname: string): boolean {
  return pathname === '/health' || pathname === '/login' || pathname.startsWith('/login/');
}

/**
 * The access gate (web-access-control, design D6/D7): every request's cookie is verified by the
 * pure session codec — no I/O, no plex.tv call — and a valid session lands on `locals.session`
 * (so even the open login page can bounce an already-authenticated user home). Gated routes
 * without one: page GETs are redirected to the login form; anything else (actions, data requests)
 * is refused outright before any facade is invoked. Tampered and expired cookies are verdicts,
 * not exceptions, and both land outside.
 */
export const handle: Handle = ({ event, resolve }) => {
  event.locals.facades = facadesOf();
  event.locals.logger = loggerOf();
  event.locals.access = accessOf();

  const cookie = event.cookies.get(SESSION_COOKIE);
  if (cookie !== undefined) {
    const verdict = verifySession(cookie, accessOf().sessionSecret, Date.now());
    if (verdict.kind === 'valid') event.locals.session = verdict.claims;
  }

  if (event.locals.session === undefined && !isOpenRoute(event.url.pathname)) {
    const method = event.request.method;
    return method === 'GET' || method === 'HEAD'
      ? new Response(undefined, { status: 303, headers: { location: '/login' } })
      : new Response('Unauthorized', { status: 403 });
  }

  return resolve(event);
};

/**
 * The read path's safety net (structured-logging doctrine). The read facades return plain values
 * and their SQLite projection reads THROW on a DB/I/O fault; without this hook SvelteKit falls
 * back to a raw `console.error` and a bare "Internal Error" — no record on the pino root, no error
 * id, no correlation. Here the unexpected fault is logged through the same root with a generated id
 * and request context, and the user is handed a shaped message carrying that id so they have
 * something concrete to quote instead of the framework default.
 */
export const handleError: HandleServerError = ({ error, event, status, message }) => {
  const errorId = crypto.randomUUID();
  loggerOf().error(
    { errorId, routeId: event.route.id, method: event.request.method, status, err: error },
    'unhandled server error',
  );
  return {
    message: `${message} If it persists, quote error ${errorId} when reporting it.`,
    errorId,
  };
};
