import { createHmac, timingSafeEqual } from 'node:crypto';
import { z } from 'zod';

/**
 * The pure session codec (design D6): HMAC-signed, self-expiring claims — no server-side session
 * state, no I/O, an injected clock. This is deliberately NOT a port: there is no external actor
 * behind verifying a cookie, so there is nothing to fake — tests exercise the one real code path
 * with cookies signed under a known secret (the mint-a-cookie doctrine, design D7). The e2e
 * harness imports `signSession` from here for exactly that reason; a second implementation would
 * be a drift seam.
 */

/** Fixed 7-day lifetime, embedded in the SIGNED claims (design D4): cookie lifetime IS the
 * re-verification cadence, so it must survive any client-side tampering with cookie metadata. */
export const SESSION_TTL_MS = 7 * 24 * 60 * 60 * 1000;

/** The session cookie's name, shared by the gate, the login routes, and the e2e harness. */
export const SESSION_COOKIE = 'md_session';

/** Who the session is for — the only identity facts the app retains (never a Plex token). */
export interface SessionIdentity {
  readonly plexAccountId: string;
  readonly username: string;
}

const claimsSchema = z.object({
  plexAccountId: z.string(),
  username: z.string(),
  expiresAt: z.number(),
});

export type SessionClaims = z.infer<typeof claimsSchema>;

/** The verdict is a value (errors-as-values): tampering and expiry are outcomes, not exceptions. */
export type SessionVerdict =
  | { readonly kind: 'valid'; readonly claims: SessionClaims }
  | { readonly kind: 'expired' }
  | { readonly kind: 'invalid' };

function signature(payload: string, secret: string): Buffer {
  return createHmac('sha256', secret).update(payload).digest();
}

/** Mint a session cookie value: base64url claims (expiry fixed at now + TTL) + HMAC signature. */
export function signSession(identity: SessionIdentity, secret: string, now: number): string {
  const claims: SessionClaims = { ...identity, expiresAt: now + SESSION_TTL_MS };
  const payload = Buffer.from(JSON.stringify(claims)).toString('base64url');
  return `${payload}.${signature(payload, secret).toString('base64url')}`;
}

/** Verify a cookie value against the secret and the injected clock. Total: never throws. */
export function verifySession(cookie: string, secret: string, now: number): SessionVerdict {
  const separator = cookie.lastIndexOf('.');
  if (separator <= 0) return { kind: 'invalid' };
  const payload = cookie.slice(0, separator);
  const presented = Buffer.from(cookie.slice(separator + 1), 'base64url');
  const expected = signature(payload, secret);
  // Length guard first: timingSafeEqual throws on unequal lengths, and a forged cookie must be a
  // verdict, not an exception.
  if (presented.length !== expected.length || !timingSafeEqual(presented, expected)) {
    return { kind: 'invalid' };
  }
  const claims = parseClaims(payload);
  if (claims === undefined) return { kind: 'invalid' };
  return claims.expiresAt > now ? { kind: 'valid', claims } : { kind: 'expired' };
}

function parseClaims(payload: string): SessionClaims | undefined {
  let json: unknown;
  try {
    json = JSON.parse(Buffer.from(payload, 'base64url').toString('utf8'));
  } catch {
    return undefined;
  }
  const parsed = claimsSchema.safeParse(json);
  return parsed.success ? parsed.data : undefined;
}
