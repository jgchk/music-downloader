import type { Handle, ServerInit } from '@sveltejs/kit';
import { bootRuntimes, facadesOf } from '$lib/server/runtime.js';

/**
 * The composed process's server hooks (design D8): `init` boots both module runtimes and the
 * seam subscriptions — SvelteKit awaits it before serving any request, which is exactly the
 * runtime-baseline guarantee ("module runtimes start before the interface accepts work") — and
 * `handle` exposes the module facades to every server route via locals. Routes see facades only;
 * the daemon lives behind $lib/server.
 */
export const init: ServerInit = async () => {
  await bootRuntimes();
};

export const handle: Handle = ({ event, resolve }) => {
  event.locals.facades = facadesOf();
  return resolve(event);
};
