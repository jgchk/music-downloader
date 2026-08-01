import { ResultAsync } from 'neverthrow';
import type { ZodType } from 'zod';
import type {
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

    const isMember = resources.some((r) => r.clientIdentifier === this.config.machineId);
    return isMember
      ? { kind: 'granted', identity: { plexAccountId: String(user.id), username } }
      : { kind: 'denied', username };
  }
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
  for (let inner = cause.cause; inner instanceof Error; inner = inner.cause) {
    messages.push(inner.message);
  }
  return unavailable(messages.join(': '));
}
