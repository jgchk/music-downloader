import { redirect } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { LOGIN_PIN_COOKIE, loginErrorPath } from '$lib/server/login-flow.js';
import { SESSION_COOKIE, SESSION_TTL_MS, signSession } from '$lib/server/session.js';

/**
 * The bounce-back from Plex's hosted auth page (design D3): refuse any PIN this browser did not
 * start (the binding cookie set by the login POST — before any plex.tv call, closing PIN-hijack
 * and login-fixation), then check the PIN once server-side, run the membership check with the
 * user's own token (design D2), and either issue the session cookie or route the outcome back to
 * the login page as an `?error=` code. The user's Plex token lives only inside this request
 * (never cookied, stored, or logged), and every failure — unbound, pending, expired, denied,
 * plex.tv down — lands OUTSIDE the gate (fail closed).
 */
export const GET: RequestHandler = async ({ cookies, locals, url }) => {
  const pinId = Number(url.searchParams.get('pin'));
  const boundPin = cookies.get(LOGIN_PIN_COOKIE);
  if (!Number.isSafeInteger(pinId) || pinId <= 0 || boundPin !== String(pinId)) {
    locals.logger.warn({ pinId }, 'login callback refused: pin not bound to this browser');
    redirect(303, loginErrorPath('invalid'));
  }
  // The binding is single-use: consumed now, whatever the outcome.
  cookies.delete(LOGIN_PIN_COOKIE, { path: '/login' });

  const check = await locals.access.plex.checkPin(pinId);
  if (check.isErr()) {
    locals.logger.warn({ detail: check.error.detail }, 'plex.tv unreachable during pin check');
    redirect(303, loginErrorPath('unavailable'));
  }
  if (check.value.kind === 'expired') {
    redirect(303, loginErrorPath('expired'));
  } else if (check.value.kind === 'pending') {
    redirect(303, loginErrorPath('incomplete'));
  }

  const membership = await locals.access.plex.checkMembership(check.value.token);
  if (membership.isErr()) {
    locals.logger.warn(
      { detail: membership.error.detail },
      'plex.tv unreachable during membership check',
    );
    redirect(303, loginErrorPath('unavailable'));
  }
  if (membership.value.kind === 'denied') {
    locals.logger.info({ username: membership.value.username }, 'login denied: not a member');
    redirect(303, loginErrorPath('denied'));
  }

  cookies.set(
    SESSION_COOKIE,
    signSession(membership.value.identity, locals.access.sessionSecret, Date.now()),
    {
      path: '/',
      httpOnly: true,
      sameSite: 'lax',
      // Explicit, not SvelteKit's ORIGIN-derived default: the session cookie must never ship
      // Secure-less to the public origin because a proxy header or ORIGIN was misconfigured.
      // (Browsers treat http://localhost as a secure context, so local dev/e2e still work.)
      secure: true,
      maxAge: SESSION_TTL_MS / 1000,
    },
  );
  locals.logger.info(
    { username: membership.value.identity.username },
    'login granted: session issued',
  );
  redirect(303, '/');
};
