## Why

The MCP endpoint (`POST /mcp`) is currently unauthenticated: anyone who can reach the process can submit and cancel acquisitions. That is fine on a private LAN, but the goal is to expose `/mcp` to Claude connectors over the public internet, where an open write surface is unacceptable. The MCP `2025-06-18` authorization spec settles exactly this: an MCP server is an OAuth 2.1 **Resource Server** that validates bearer access tokens minted by a separate Authorization Server. A self-hosted Keycloak realm (`https://auth.jake.cafe/realms/homelab`) is already live to be that Authorization Server.

This change makes `/mcp` a compliant Resource Server — **without turning it on yet**. It ships **config-dormant**: with no issuer configured, `/mcp` behaves exactly as today (unauthenticated, no new routes enforced). Activation is a later, separate, config-only step (set two env vars), so the risky protocol/edge code lands, is reviewed, released, and deployed cold before any auth is switched on.

## What Changes

- **Config (12-factor, config-gated on `OAUTH_ISSUER`):** two new environment variables — `OAUTH_ISSUER` (the Authorization Server's issuer URL) and `OAUTH_RESOURCE` (this server's canonical resource identifier = its public MCP URL). When `OAUTH_ISSUER` is set, `OAUTH_RESOURCE` is **required** (fail-loud otherwise). An optional `OAUTH_JWKS_URI` overrides JWKS discovery; absent, the JWKS URI is derived from the issuer's OIDC discovery document (fetched once, cached). Unset `OAUTH_ISSUER` ⇒ the whole feature is dormant.
- **Protected Resource Metadata (RFC 9728):** a new well-known route `GET /.well-known/oauth-protected-resource` returning `{ "resource": "<OAUTH_RESOURCE>", "authorization_servers": ["<OAUTH_ISSUER>"], "bearer_methods_supported": ["header"] }`. Registered only when configured.
- **Bearer enforcement on `/mcp`** (only when configured): require `Authorization: Bearer <jwt>`; validate the JWT (signature via the issuer's JWKS, `iss` === `OAUTH_ISSUER`, `exp`/`nbf`, and audience — `aud`, or the RFC 8707 `resource`/`azp` claim, MUST include `OAUTH_RESOURCE`). On any failure (missing / malformed / bad signature / expired / wrong issuer / wrong audience) → `401` with `WWW-Authenticate: Bearer resource_metadata="<public base>/.well-known/oauth-protected-resource"` (RFC 9728 §5.1). Validation outcomes are modeled as typed values (neverthrow), mapped to 401. JWKS is cached and tolerant of key rotation.
- **Thin edge, unchanged tools:** a Fastify preHandler on the `/mcp` route plus the one well-known route. MCP tool/resource behavior is untouched.

## Capabilities

### New Capabilities

<!-- none -->

### Modified Capabilities

- `public-api`: the MCP endpoint becomes an OAuth 2.1 Resource Server — protected-resource metadata discovery, bearer-token enforcement with JWKS signature/issuer/expiry/audience validation, and RFC 9728 `WWW-Authenticate` challenge. Config-dormant: unconfigured, `/mcp` stays open and the well-known route is not registered.

## Impact

- `src/composition/config.ts` (+ `config.test.ts`) — the `oauth` config block and its fail-loud rules.
- `src/interfaces/mcp/` — a new bearer-verification edge (JWKS-backed JWT validation as typed values) + the protected-resource-metadata and `/mcp` preHandler wiring; `registerMcpEndpoint` gains an optional auth config.
- `src/interfaces/http/app.ts` — thread the optional oauth config through `HttpAppOptions`.
- `src/composition/index.ts` — construct the verifier from config and pass it through; startup log line stating whether MCP auth is active or dormant.
- `package.json` — `jose` promoted to a direct dependency (JWKS + JWT verification).
- Tests: config parsing (dormant + fail-loud), the metadata route body, and bearer enforcement (missing/invalid/expired/wrong-audience → 401 with the correct challenge; valid → passes through to the existing handler; dormant → open), plus an in-process e2e proving a valid token reaches a tool and an unauthenticated call is refused when configured.
