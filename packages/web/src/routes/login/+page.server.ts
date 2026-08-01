import { fail, redirect } from '@sveltejs/kit';
import type { Actions, PageServerLoad } from './$types';
import {
  LOGIN_ERROR_MESSAGES,
  LOGIN_PIN_COOKIE,
  LOGIN_PIN_TTL_SECONDS,
} from '$lib/server/login-flow.js';
import { plexAuthUrl } from '$lib/server/plex/auth-url.js';

/**
 * The door (web-access-control, design D3): the page renders statically — no upstream call on
 * GET, so crawlers and rate-limit probes cost nothing — and the form POST is the only thing that
 * creates a Plex PIN, redirecting the whole tab to Plex's hosted auth page with a forward URL
 * back to our callback. The created PIN id is also bound to THIS browser via a short-lived
 * cookie, so the callback can refuse a PIN someone else started (design D3's state binding).
 * Denials and failures arrive back here as `?error=` codes from the callback; plex.tv being down
 * is a modeled 503 re-render, never a grant.
 */

export const load: PageServerLoad = ({ locals, url }) => {
  // Already signed in (the gate verified the cookie even on this open route): nothing to do here.
  if (locals.session !== undefined) redirect(303, '/');
  const code = url.searchParams.get('error');
  // The query is user-writable: unknown codes degrade to the generic message, never raw text.
  return {
    error:
      code === null
        ? undefined
        : (LOGIN_ERROR_MESSAGES[code as keyof typeof LOGIN_ERROR_MESSAGES] ??
          LOGIN_ERROR_MESSAGES.invalid),
  };
};

export const actions: Actions = {
  default: async ({ cookies, locals, url }) => {
    const pin = await locals.access.plex.createPin();
    if (pin.isErr()) {
      locals.logger.warn({ detail: pin.error.detail }, 'plex.tv unreachable during login start');
      return fail(503, {
        error: 'Plex could not be reached to start the sign-in. Try again shortly.',
      });
    }
    cookies.set(LOGIN_PIN_COOKIE, String(pin.value.id), {
      path: '/login',
      httpOnly: true,
      sameSite: 'lax',
      secure: true,
      maxAge: LOGIN_PIN_TTL_SECONDS,
    });
    const forwardUrl = `${url.origin}/login/callback?pin=${pin.value.id}`;
    redirect(303, plexAuthUrl(pin.value.code, forwardUrl));
  },
};
