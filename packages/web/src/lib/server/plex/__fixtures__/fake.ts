import { errAsync, okAsync } from 'neverthrow';
import type { ResultAsync } from 'neverthrow';
import type {
  MembershipOutcome,
  PinCheckOutcome,
  PlexAccessPort,
  PlexPin,
  PlexUnavailable,
} from '../port.js';

/**
 * In-memory fake of OUR PlexAccess port for unit tests (design D7): the composition-root swap the
 * literature blesses lives HERE, in the test's process — never as a selectable strategy in the
 * shipped artifact. Behaviors are per-operation scripted outcomes (one fixed result per
 * operation, plus a fail flag for the Err track) so a test can script grant, denial, pending, and
 * outage paths without touching plex.tv's wire shapes (GOOS: don't mock what you don't own).
 */

const UNAVAILABLE: PlexUnavailable = { kind: 'plex-unavailable', detail: 'fake outage' };

export class FakePlexAccess implements PlexAccessPort {
  pin: PlexPin = { id: 7, code: 'fake-code' };
  pinCheck: PinCheckOutcome = { kind: 'authorized', token: 'fake-token' };
  membership: MembershipOutcome = {
    kind: 'granted',
    identity: { plexAccountId: '1', username: 'owner' },
    role: 'owner',
  };
  /** Flip any of these to script the Err track (plex.tv down) per operation. */
  failCreatePin = false;
  failCheckPin = false;
  failCheckMembership = false;

  /** What each operation received, for asserting the flow passes the right things along. */
  readonly seen: { checkedPins: number[]; membershipTokens: string[] } = {
    checkedPins: [],
    membershipTokens: [],
  };

  createPin(): ResultAsync<PlexPin, PlexUnavailable> {
    return this.failCreatePin ? errAsync(UNAVAILABLE) : okAsync(this.pin);
  }

  checkPin(pinId: number): ResultAsync<PinCheckOutcome, PlexUnavailable> {
    this.seen.checkedPins.push(pinId);
    return this.failCheckPin ? errAsync(UNAVAILABLE) : okAsync(this.pinCheck);
  }

  checkMembership(token: string): ResultAsync<MembershipOutcome, PlexUnavailable> {
    this.seen.membershipTokens.push(token);
    return this.failCheckMembership ? errAsync(UNAVAILABLE) : okAsync(this.membership);
  }
}
