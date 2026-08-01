import type { ResultAsync } from 'neverthrow';
import type { SessionIdentity } from '../session.js';

/**
 * The ONE port behind the access gate (design D6): the plex.tv conversation the login flow needs.
 * Everything else about auth is pure computation (the session codec). Business outcomes — pending
 * PINs, denied membership — are values on the Ok track; only plex.tv being unreachable, erroring,
 * or breaking contract is the Err track, and it NEVER becomes a grant (fail closed, design D2).
 */

/** plex.tv is down, erroring, or off-contract. `detail` carries no token, ever. */
export interface PlexUnavailable {
  readonly kind: 'plex-unavailable';
  readonly detail: string;
}

/** A created PIN: `id` is checked server-side; `code` rides to the hosted auth page. */
export interface PlexPin {
  readonly id: number;
  readonly code: string;
}

/** The one-shot PIN check: approved (token in hand), still pending, or gone (expired/unknown). */
export type PinCheckOutcome =
  | { readonly kind: 'authorized'; readonly token: string }
  | { readonly kind: 'pending' }
  | { readonly kind: 'expired' };

/** The membership verdict: the token's account either sees the owner's server or it does not. */
export type MembershipOutcome =
  | { readonly kind: 'granted'; readonly identity: SessionIdentity }
  | { readonly kind: 'denied'; readonly username: string };

export interface PlexAccessPort {
  createPin(): ResultAsync<PlexPin, PlexUnavailable>;
  checkPin(pinId: number): ResultAsync<PinCheckOutcome, PlexUnavailable>;
  /** "Does this token's account see machine `<id>`?" — the whole authorization model (D2). */
  checkMembership(token: string): ResultAsync<MembershipOutcome, PlexUnavailable>;
}
