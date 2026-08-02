import { redirect } from '@sveltejs/kit';
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
 * credential-less. An exact set, not a prefix: a future route born under /login/ starts out
 * GATED until deliberately listed here (fail closed).
 */
const OPEN_ROUTES = new Set(['/health', '/login', '/login/callback']);

/**
 * The access gate (web-access-control, design D6/D7): every request's cookie is verified by the
 * pure session codec — no I/O, no plex.tv call — and a valid session lands on `locals.session`
 * (so even the open login page can bounce an already-authenticated user home). Gated routes
 * without one: GET/HEAD requests (pages, and SvelteKit's __data.json data requests are GETs too)
 * are redirected to the login form; non-GET requests (form actions) are refused outright with a
 * 403 — either way, before any facade is invoked. Tampered and expired cookies are verdicts, not
 * exceptions, and both land outside; a cookie that FAILS VERIFICATION (malformed, forged, or
 * unparseable — anything but valid/expired) is logged as the tamper signal it is.
 */
export const handle: Handle = ({ event, resolve }) => {
  event.locals.facades = facadesOf();
  event.locals.logger = loggerOf();
  event.locals.access = accessOf();
  event.locals.now = () => new Date().toISOString();

  const cookie = event.cookies.get(SESSION_COOKIE);
  if (cookie !== undefined) {
    const verdict = verifySession(cookie, event.locals.access.sessionSecret, Date.now());
    if (verdict.kind === 'valid') {
      event.locals.session = verdict.claims;
    } else if (verdict.kind === 'invalid') {
      // A cookie that FAILS VERIFICATION (vs merely expiring) is a forgery/tamper signal an
      // operator must be able to see — distinct from the routine no-cookie and expired cases.
      event.locals.logger.warn(
        { pathname: event.url.pathname },
        'session cookie failed verification',
      );
    }
  }

  if (event.locals.session === undefined && !OPEN_ROUTES.has(event.url.pathname)) {
    const method = event.request.method;
    if (method === 'GET' || method === 'HEAD') {
      // SvelteKit's thrown redirect, NOT a hand-built 303: for a client-side `__data.json`
      // request the framework converts it to the JSON redirect envelope the SPA router expects —
      // a raw 303 would be followed to the login page's HTML and explode in the data parser.
      redirect(303, '/login');
    }
    event.locals.logger.warn(
      { pathname: event.url.pathname, method },
      'unauthenticated non-GET refused by the access gate',
    );
    return new Response('Unauthorized', { status: 403 });
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
