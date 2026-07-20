import { type CryptoKey, type JWTPayload, type JWTVerifyGetKey, jwtVerify } from 'jose';
import { type Result, err, ok } from 'neverthrow';

/**
 * The MCP endpoint's OAuth 2.1 Resource Server edge (change: mcp-oauth-resource-server). This module
 * is the *only* place that validates bearer access tokens: it verifies a JWT's signature against the
 * Authorization Server's JWKS, its issuer, its expiry (`exp`/`nbf`), and — critically — its audience
 * binding to this server's canonical resource identifier (RFC 8707 / RFC 9728). Validation outcomes
 * are modeled as typed values (neverthrow), never thrown, so the HTTP edge maps every failure to a
 * single `401` challenge without a try/catch of its own. It is a pure edge: it knows nothing of the
 * MCP tools it guards, and when auth is unconfigured it is never constructed at all.
 */

/** RFC 9728 well-known location for OAuth 2.0 Protected Resource Metadata. */
export const PROTECTED_RESOURCE_METADATA_PATH = '/.well-known/oauth-protected-resource';

/** A rejected token, as a value. Both kinds map to the same `401` at the edge; the reason aids logs. */
export type AuthError =
  | { readonly kind: 'MissingToken' } // no / malformed `Authorization: Bearer <jwt>` header
  | { readonly kind: 'InvalidToken'; readonly reason: string }; // failed signature/iss/exp/audience

/** The minimal accepted-token facts the edge needs (identity for logs; the surface is unchanged). */
export interface VerifiedToken {
  readonly subject: string | undefined;
}

/** A key source jose can verify against: a remote JWKS (production) or a fixed key (tests). */
export type KeySource = CryptoKey | JWTVerifyGetKey;

export interface TokenVerifier {
  verify(authorization: string | undefined): Promise<Result<VerifiedToken, AuthError>>;
}

/** OAuth 2.0 Protected Resource Metadata (RFC 9728), as served at the well-known path. */
export interface ProtectedResourceMetadata {
  readonly resource: string;
  readonly authorization_servers: readonly string[];
  readonly bearer_methods_supported: readonly string[];
}

export function protectedResourceMetadata(
  issuer: string,
  resource: string,
): ProtectedResourceMetadata {
  return { resource, authorization_servers: [issuer], bearer_methods_supported: ['header'] };
}

/**
 * The `resource_metadata` URL for the `WWW-Authenticate` challenge (RFC 9728 §5.1): the metadata
 * document lives at the well-known path on the resource's own origin (scheme+host), so a client
 * challenged on `/mcp` can discover the authorization server for exactly this resource.
 */
export function resourceMetadataUrl(resource: string): string {
  return `${new URL(resource).origin}${PROTECTED_RESOURCE_METADATA_PATH}`;
}

/** Extract the `<jwt>` from an `Authorization: Bearer <jwt>` header, tolerantly and case-insensitively. */
function extractBearer(authorization: string | undefined): Result<string, AuthError> {
  if (authorization === undefined) return err({ kind: 'MissingToken' });
  const parts = authorization.trim().split(/\s+/);
  if (parts.length !== 2 || parts[0]?.toLowerCase() !== 'bearer' || parts[1] === '') {
    return err({ kind: 'MissingToken' });
  }
  return ok(parts[1]!);
}

/** Normalize a claim that may be a string, an array of strings, or absent into a string list. */
function asStrings(claim: unknown): readonly string[] {
  if (typeof claim === 'string') return [claim];
  if (Array.isArray(claim)) return claim.filter((v): v is string => typeof v === 'string');
  return [];
}

/**
 * The audience check the spec makes mandatory: the token must be *bound to this resource*. Keycloak
 * conveys the intended resource differently depending on its mapper config, so an exact match in any
 * of the standard carriers is accepted — `aud` (RFC 7519), the RFC 8707 `resource` claim, or `azp` —
 * while still requiring an explicit match (a token with none of these naming this resource is rejected).
 */
function audienceIncludesResource(payload: JWTPayload, resource: string): boolean {
  const carriers = [
    ...asStrings(payload.aud),
    ...asStrings(payload.resource),
    ...asStrings(payload.azp),
  ];
  return carriers.includes(resource);
}

/**
 * Build a verifier bound to one issuer + resource + key source. `jose.jwtVerify` performs the
 * signature, issuer, and `exp`/`nbf` checks (and refetches keys on rotation when the key source is a
 * remote JWKS); it throws on any failure, which we catch and map to a typed `InvalidToken`. The
 * audience binding is enforced on top, since jose's `audience` option would accept only `aud`.
 */
export function createTokenVerifier(params: {
  readonly issuer: string;
  readonly resource: string;
  readonly keySource: KeySource;
}): TokenVerifier {
  const { issuer, resource, keySource } = params;
  return {
    async verify(authorization) {
      const token = extractBearer(authorization);
      if (token.isErr()) return err(token.error);
      try {
        // Branch so each call hits a distinct `jwtVerify` overload (fixed key vs. a JWKS getKey
        // function) — a union argument satisfies neither overload on its own.
        const { payload } =
          typeof keySource === 'function'
            ? await jwtVerify(token.value, keySource, { issuer })
            : await jwtVerify(token.value, keySource, { issuer });
        if (!audienceIncludesResource(payload, resource)) {
          return err({ kind: 'InvalidToken', reason: 'audience' });
        }
        return ok({ subject: typeof payload.sub === 'string' ? payload.sub : undefined });
      } catch (error) {
        return err({
          kind: 'InvalidToken',
          reason: error instanceof Error ? error.message : 'invalid',
        });
      }
    },
  };
}
