import { redirect } from '@sveltejs/kit';
import type { Actions, PageServerLoad } from './$types';
import { SESSION_COOKIE } from '$lib/server/session.js';

/**
 * Sign out (web-access-control): one form action clearing the session cookie. There is no page
 * here — a stray GET just goes home (the gate has already ensured a session exists).
 */
export const load: PageServerLoad = () => {
  redirect(303, '/');
};

export const actions: Actions = {
  default: ({ cookies }) => {
    cookies.delete(SESSION_COOKIE, { path: '/' });
    redirect(303, '/login');
  },
};
