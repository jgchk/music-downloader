import type { Handle, HandleServerError, ServerInit } from '@sveltejs/kit';
import { env } from '$env/dynamic/private';
import { bootRuntimes, facadesOf, loggerOf } from '$lib/server/runtime.js';

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

export const handle: Handle = ({ event, resolve }) => {
  event.locals.facades = facadesOf();
  event.locals.logger = loggerOf();
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
