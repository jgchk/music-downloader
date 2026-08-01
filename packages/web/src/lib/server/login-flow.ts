/**
 * The login flow's shared vocabulary: the outcome codes the callback emits and the login page
 * renders, plus the PIN-binding cookie both ends of the redirect share. One module so the
 * producer (callback redirects) and consumer (page messages) are type-linked — a new outcome
 * added at the callback fails to compile until it has a message — while the page keeps a runtime
 * fallback for forged/unknown `?error=` strings (the URL is a user-writable channel).
 */

export type LoginErrorCode = 'denied' | 'expired' | 'incomplete' | 'invalid' | 'unavailable';

/** The callback's outcome codes, rendered as human sentences (never raw enum text). */
export const LOGIN_ERROR_MESSAGES: Record<LoginErrorCode, string> = {
  denied: 'Your Plex account does not have access to this server.',
  expired: 'That sign-in attempt expired. Try again.',
  incomplete: 'The sign-in was not completed on Plex. Try again.',
  invalid: 'That sign-in link was not valid. Try again.',
  unavailable: 'Plex could not be reached to complete the sign-in. Try again shortly.',
};

/** The login page path a callback outcome redirects to. */
export function loginErrorPath(code: LoginErrorCode): string {
  return `/login?error=${code}`;
}

/**
 * Binds the created PIN to the browser that started the login (the OAuth `state` parameter's
 * role): the login POST sets this short-lived cookie with the PIN id, and the callback refuses —
 * before any plex.tv call — a PIN the presenting browser did not start. Without it, an attacker
 * could complete a victim's PIN (the ids are guessable incrementing integers) or fix a victim
 * onto the attacker's session by luring them to the callback URL.
 */
export const LOGIN_PIN_COOKIE = 'md_login_pin';

/** The binding cookie's lifetime: ample for a Plex approval, short enough to be disposable. */
export const LOGIN_PIN_TTL_SECONDS = 10 * 60;
