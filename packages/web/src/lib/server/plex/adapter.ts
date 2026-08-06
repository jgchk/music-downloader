import { ResultAsync } from 'neverthrow';
import type { ZodType } from 'zod';
import type { SessionIdentity } from '../session.js';
import type {
  DenialReason,
  MembershipOutcome,
  PinCheckOutcome,
  PlexAccessPort,
  PlexPin,
  PlexUnavailable,
} from './port.js';
import {
  plexPinCheckSchema,
  plexPinCreateSchema,
  plexResourcesSchema,
  plexUserSchema,
} from './schemas.js';
import type { PlexResources } from './schemas.js';

/**
 * The plex.tv adapter behind {@link PlexAccessPort} (design D6): real HTTP against
 * `PLEX_API_BASE_URL`, responses enforced through the contract schemas, faults and contract
 * violations surfacing as {@link PlexUnavailable} values naming plex.tv — never a grant, never a
 * throw escaping the port. Tokens ride request headers only; no token is ever logged, thrown, or
 * embedded in an error detail.
 */

import { PLEX_CLIENT_IDENTIFIER, PLEX_PRODUCT } from './identity.js';

/** The identifying headers Plex requires on every api v2 call (PIN pairing contract). */
const IDENTITY_HEADERS = {
  Accept: 'application/json',
  'X-Plex-Product': PLEX_PRODUCT,
  'X-Plex-Client-Identifier': PLEX_CLIENT_IDENTIFIER,
};

function unavailable(detail: string): PlexUnavailable {
  return { kind: 'plex-unavailable', detail };
}

export class PlexTvAccess implements PlexAccessPort {
  constructor(
    private readonly config: { readonly baseUrl: string; readonly machineId: string },
    private readonly fetchImpl: typeof fetch = fetch,
  ) {}

  createPin(): ResultAsync<PlexPin, PlexUnavailable> {
    return ResultAsync.fromPromise(this.doCreatePin(), toUnavailable);
  }

  checkPin(pinId: number): ResultAsync<PinCheckOutcome, PlexUnavailable> {
    return ResultAsync.fromPromise(this.doCheckPin(pinId), toUnavailable);
  }

  checkMembership(token: string): ResultAsync<MembershipOutcome, PlexUnavailable> {
    return ResultAsync.fromPromise(this.doCheckMembership(token), toUnavailable);
  }

  private async doCreatePin(): Promise<PlexPin> {
    // strong=true asks for a long code suited to forward-URL (non-typed) pairing.
    const response = await this.fetchImpl(`${this.config.baseUrl}/pins?strong=true`, {
      method: 'POST',
      headers: IDENTITY_HEADERS,
    });
    if (!response.ok) throw new PlexHttpError('pin create', response.status);
    const pin = parseOrThrow(plexPinCreateSchema, await response.json(), 'pin create');
    return { id: pin.id, code: pin.code };
  }

  private async doCheckPin(pinId: number): Promise<PinCheckOutcome> {
    const response = await this.fetchImpl(`${this.config.baseUrl}/pins/${pinId}`, {
      headers: IDENTITY_HEADERS,
    });
    // Plex answers 404 for a PIN that expired or never existed — a business outcome, not a fault.
    if (response.status === 404) return { kind: 'expired' };
    if (!response.ok) throw new PlexHttpError('pin check', response.status);
    const pin = parseOrThrow(plexPinCheckSchema, await response.json(), 'pin check');
    const token = pin.authToken;
    // Empty OR nullish: `authorized` must imply a usable token, never a blank one.
    return token === '' || token == null ? { kind: 'pending' } : { kind: 'authorized', token };
  }

  private async doCheckMembership(token: string): Promise<MembershipOutcome> {
    const headers = { ...IDENTITY_HEADERS, 'X-Plex-Token': token };

    const userResponse = await this.fetchImpl(`${this.config.baseUrl}/user`, { headers });
    if (!userResponse.ok) throw new PlexHttpError('user lookup', userResponse.status);
    const user = parseOrThrow(plexUserSchema, await userResponse.json(), 'user lookup');
    const username = user.username ?? user.title ?? String(user.id);

    const resourcesResponse = await this.fetchImpl(`${this.config.baseUrl}/resources`, { headers });
    if (!resourcesResponse.ok) throw new PlexHttpError('resources', resourcesResponse.status);
    const resources = parseOrThrow(
      plexResourcesSchema,
      await resourcesResponse.json(),
      'resources',
    );

    return resolveMembership(
      { plexAccountId: String(user.id), username },
      resources,
      this.config.machineId,
    );
  }
}

/**
 * The membership predicate and role derivation, as a pure function of the parsed listing
 * (web-access-control). Kept out of the HTTP method so the access-control policy can be read,
 * tested, and later extended — the recorded follow-up pins the owner by account identity — without
 * touching transport or parsing.
 *
 * Admission requires an entry that BOTH carries the configured machine identifier AND declares a
 * server. That is a strict narrowing, NOT an attestation: device/player identifiers are
 * client-chosen, and the server class is self-asserted by the same mechanism (see
 * `docs/research/plex-machine-identifier-trust.md`). It closes the trivially-exploitable device
 * shape; the account-identity pin is the recorded follow-up that makes the gate trustworthy.
 */
export function resolveMembership(
  identity: SessionIdentity,
  resources: PlexResources,
  machineId: string,
): MembershipOutcome {
  const idMatches = resources.filter((r) => r.clientIdentifier === machineId);
  // Only entries passing the WHOLE predicate are candidates — the role must never be read from an
  // entry that failed it (a device carrying our identifier is always `owned` by whoever made it).
  const candidates = idMatches.filter((r) => isServerResource(r.provides));
  if (candidates.length === 0) return { kind: 'denied', ...denial(identity.username, idMatches) };
  return {
    kind: 'granted',
    identity,
    // Owner iff ANY admitting entry is owned: duplicate machine identifiers occur in the wild
    // (cloned VMs, restored Preferences.xml), and listing ORDER must not decide privilege.
    // An absent flag is a guest — least privilege (design D2).
    role: candidates.some((r) => r.owned === true) ? 'owner' : 'guest',
  };
}

/** Which refusal shape this was, so the operator can tell attack traffic from contract drift. */
function denial(
  username: string,
  idMatches: readonly PlexResources[number][],
): { username: string; reason: DenialReason } {
  if (idMatches.length === 0) return { username, reason: 'no-machine-match' };
  const hasCapabilities = idMatches.some((r) => r.provides !== undefined);
  return {
    username,
    reason: hasCapabilities ? 'matched-non-server' : 'matched-no-capabilities',
  };
}

/** Does the comma-separated capability list name a server? Trimmed and case-insensitive, so
 * formatting drift in plex.tv's list never silently widens or narrows admission. Exported so the
 * contract recorder asks the question exactly the way the predicate does. */
export function isServerResource(provides: string | undefined): boolean {
  if (provides === undefined) return false;
  return provides.split(',').some((capability) => capability.trim().toLowerCase() === 'server');
}

/** An operation label + HTTP status; deliberately carries neither URL query nor headers. */
class PlexHttpError extends Error {
  constructor(operation: string, status: number) {
    super(`plex.tv ${operation} answered ${status}`);
  }
}

function parseOrThrow<T>(schema: ZodType<T>, json: unknown, operation: string): T {
  const parsed = schema.safeParse(json);
  if (!parsed.success) {
    const paths = parsed.error.issues.map((issue) => issue.path.join('.') || '(root)').join(', ');
    throw new Error(`plex.tv ${operation} violated the consumed contract at ${paths}`);
  }
  return parsed.data;
}

/**
 * Fault classifier: whatever escaped (fetch fault, contract break) becomes a token-free value.
 * Node's `fetch` buries the actual transport reason (ECONNREFUSED, DNS, TLS) in `Error.cause`, so
 * the chain is flattened into the detail — cause messages are transport errors, which never echo
 * request headers, so the token-free guarantee holds.
 */
function toUnavailable(cause: unknown): PlexUnavailable {
  if (!(cause instanceof Error)) return unavailable(String(cause));
  const messages = [cause.message];
  // Depth-capped so a (hypothetical) self-referential cause chain cannot spin forever.
  for (
    let inner = cause.cause, depth = 0;
    inner instanceof Error && depth < 5;
    inner = inner.cause, depth += 1
  ) {
    messages.push(inner.message);
  }
  return unavailable(messages.join(': '));
}
