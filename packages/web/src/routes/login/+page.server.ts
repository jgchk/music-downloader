import { fail, redirect } from '@sveltejs/kit';
import type { Actions, PageServerLoad } from './$types';
import { plexAuthUrl } from '$lib/server/plex/auth-url.js';

/**
 * The door (web-access-control, design D3): the page renders statically — no upstream call on
 * GET, so crawlers and rate-limit probes cost nothing — and the form POST is the only thing that
 * creates a Plex PIN, redirecting the whole tab to Plex's hosted auth page with a forward URL
 * back to our callback. Denials and failures arrive back here as `?error=` codes from the
 * callback; plex.tv being down is a modeled 503 re-render, never a grant.
 */

/** The callback's outcome codes, rendered as human sentences (never raw enum text). */
const ERROR_MESSAGES: Record<string, string> = {
  denied: 'Your Plex account does not have access to this server.',
  expired: 'That sign-in attempt expired. Try again.',
  incomplete: 'The sign-in was not completed on Plex. Try again.',
  invalid: 'That sign-in link was not valid. Try again.',
  unavailable: 'Plex could not be reached to complete the sign-in. Try again shortly.',
};

export const load: PageServerLoad = ({ locals, url }) => {
  // Already signed in (the gate verified the cookie even on this open route): nothing to do here.
  if (locals.session !== undefined) redirect(303, '/');
  const code = url.searchParams.get('error');
  return { error: code === null ? undefined : (ERROR_MESSAGES[code] ?? ERROR_MESSAGES['invalid']) };
};

export const actions: Actions = {
  default: async ({ locals, url }) => {
    const pin = await locals.access.plex.createPin();
    if (pin.isErr()) {
      locals.logger.warn({ detail: pin.error.detail }, 'plex.tv unreachable during login start');
      return fail(503, {
        error: 'Plex could not be reached to start the sign-in. Try again shortly.',
      });
    }
    const forwardUrl = `${url.origin}/login/callback?pin=${pin.value.id}`;
    redirect(303, plexAuthUrl(pin.value.code, forwardUrl));
  },
};
