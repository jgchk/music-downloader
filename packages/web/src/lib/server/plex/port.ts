import type { ResultAsync } from 'neverthrow';
import type { Role, SessionIdentity } from '../session.js';

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

/**
 * Why a membership check refused. Admission is unaffected — every reason denies — but the three
 * shapes are operationally distinct and must not collapse into one log line: `matched-non-server`
 * is the attack signal (someone's device carries our machine id), while `matched-no-capabilities`
 * is the plex.tv contract-drift signal that would lock EVERY user out, including the owner.
 */
export type DenialReason =
  /** No entry carried the configured machine identifier — an ordinary stranger. */
  | 'no-machine-match'
  /** An entry matched the identifier but declared capabilities that do not include a server. */
  | 'matched-non-server'
  /** An entry matched the identifier but declared no capabilities at all (drift-shaped). */
  | 'matched-no-capabilities';

/**
 * The membership verdict: the token's account either reaches an entry declaring the owner's
 * server or it does not. A grant carries the role the ADMITTING entries' ownership flags imply
 * (owner iff any of them is owned) — the single point where a role is derived FROM PLEX.TV FACTS.
 * (The session codec's guest default for pre-role cookies is a least-privilege floor, not a
 * derivation.)
 */
export type MembershipOutcome =
  | { readonly kind: 'granted'; readonly identity: SessionIdentity; readonly role: Role }
  | { readonly kind: 'denied'; readonly username: string; readonly reason: DenialReason };

export interface PlexAccessPort {
  createPin(): ResultAsync<PlexPin, PlexUnavailable>;
  checkPin(pinId: number): ResultAsync<PinCheckOutcome, PlexUnavailable>;
  /** "Does this token's account see machine `<id>`?" — the whole authorization model (D2). */
  checkMembership(token: string): ResultAsync<MembershipOutcome, PlexUnavailable>;
}
