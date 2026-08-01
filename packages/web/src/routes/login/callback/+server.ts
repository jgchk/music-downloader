import { redirect } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { SESSION_COOKIE, SESSION_TTL_MS, signSession } from '$lib/server/session.js';

/**
 * The bounce-back from Plex's hosted auth page (design D3): check the PIN once server-side, run
 * the membership check with the user's own token (design D2), and either issue the session cookie
 * or route the outcome back to the login page as an `?error=` code. The user's Plex token lives
 * only inside this request (never cookied, stored, or logged), and every failure — pending,
 * expired, denied, plex.tv down — lands OUTSIDE the gate (fail closed).
 */
export const GET: RequestHandler = async ({ cookies, locals, url }) => {
  const pinId = Number(url.searchParams.get('pin'));
  if (!Number.isSafeInteger(pinId) || pinId <= 0) redirect(303, '/login?error=invalid');

  const check = await locals.access.plex.checkPin(pinId);
  if (check.isErr()) {
    locals.logger.warn({ detail: check.error.detail }, 'plex.tv unreachable during pin check');
    redirect(303, '/login?error=unavailable');
  }
  if (check.value.kind === 'expired') {
    redirect(303, '/login?error=expired');
  } else if (check.value.kind === 'pending') {
    redirect(303, '/login?error=incomplete');
  }

  const membership = await locals.access.plex.checkMembership(check.value.token);
  if (membership.isErr()) {
    locals.logger.warn(
      { detail: membership.error.detail },
      'plex.tv unreachable during membership check',
    );
    redirect(303, '/login?error=unavailable');
  }
  if (membership.value.kind === 'denied') {
    locals.logger.info({ username: membership.value.username }, 'login denied: not a member');
    redirect(303, '/login?error=denied');
  }

  cookies.set(
    SESSION_COOKIE,
    signSession(membership.value.identity, locals.access.sessionSecret, Date.now()),
    { path: '/', httpOnly: true, sameSite: 'lax', maxAge: SESSION_TTL_MS / 1000 },
  );
  locals.logger.info(
    { username: membership.value.identity.username },
    'login granted: session issued',
  );
  redirect(303, '/');
};
