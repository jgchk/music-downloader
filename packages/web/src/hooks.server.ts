import type { Handle, ServerInit } from '@sveltejs/kit';
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
