## Context

Claude connectors authenticate to remote MCP servers via OAuth 2.1 as defined by the MCP `2025-06-18` authorization spec. In that model the MCP server is a **Resource Server** only: it never issues tokens, runs no login UI, and holds no client secret. It advertises which Authorization Server(s) protect it (RFC 9728 Protected Resource Metadata), and it validates the bearer access tokens those servers mint (signature, issuer, expiry, audience). The Authorization Server is a separate, already-live Keycloak realm (`https://auth.jake.cafe/realms/homelab`); nginx and the Keycloak client are wired outside this repo.

This change is the Resource-Server half only, and it ships **cold**. The single most important property is: **unconfigured, nothing changes.** The current LAN deployment must keep working with an open `/mcp`, and this release must be deployable with zero behavioral change so the edge code can bake before auth is activated by config alone.

## Goals / Non-Goals

**Goals:**

- Compliant RFC 9728 discovery + RFC 6750/8707 bearer validation on `/mcp`, gated entirely on config.
- Fail loud on half-configured auth (issuer without resource) — never silently run insecure.
- Keep it a thin edge: no change to MCP tool/resource semantics, no new coupling in the domain or application layers.
- Model validation failures as typed values (neverthrow), not thrown exceptions, per the errors-are-values rule.

**Non-Goals:**

- No Authorization Server behavior: no token issuance, no `/authorize`/`/token`, no Dynamic Client Registration, no login UI. Keycloak owns all of that.
- No Authorization Server Metadata (`/.well-known/oauth-authorization-server`) — that is the AS's document; we only publish Protected Resource Metadata and point at the issuer.
- No scope/permission model beyond audience binding (every valid token for this resource may use every tool, as today). Finer authZ is additive later.
- No activation in this change: `OAUTH_ISSUER`/`OAUTH_RESOURCE` are left unset on deploy. Turning auth on is a separate config-only step.

## Decisions

### D1 — Config-gated on `OAUTH_ISSUER`, fail-loud on partial config

`OAUTH_ISSUER` is the master switch. Absent (or blank) ⇒ `config.oauth` is `undefined`, the well-known route is not registered, and no preHandler is attached to `/mcp` — the surface is byte-for-byte what it was before. When `OAUTH_ISSUER` is present, `OAUTH_RESOURCE` is **required**: a missing resource is a fatal `MissingVar` startup error, never a silent fallback — a Resource Server that cannot check audience must not accept tokens. `OAUTH_JWKS_URI` is optional; when set it is used verbatim, otherwise the JWKS URI is discovered from `${issuer}/.well-known/openid-configuration` (`jwks_uri`), fetched once at construction and cached. Mirrors the existing `webhooks`/`verdictWebhook` config-dormant precedent exactly, so the pattern is already blessed here.

`OAUTH_RESOURCE` for this service is its public MCP URL: `https://music-dl.jake.cafe/mcp`. This is the canonical resource identifier (RFC 8707 §2 / RFC 9728) clients pass as the `resource` parameter and that tokens must be audience-bound to.

### D2 — Protected Resource Metadata (RFC 9728) at a fixed well-known path

`GET /.well-known/oauth-protected-resource` returns exactly:

```json
{
  "resource": "https://music-dl.jake.cafe/mcp",
  "authorization_servers": ["https://auth.jake.cafe/realms/homelab"],
  "bearer_methods_supported": ["header"]
}
```

`resource` = `OAUTH_RESOURCE`, `authorization_servers` = `[OAUTH_ISSUER]`. It is unauthenticated (a discovery document is public by design) and registered only when configured. It is excluded from the OpenAPI document (like `/mcp`) — it is a protocol well-known, not part of the versioned REST contract.

### D3 — Bearer enforcement is a Fastify preHandler on `/mcp`, backed by a typed verifier

A `preHandler` hook runs before the existing `/mcp` POST handler. It extracts the `Authorization: Bearer <jwt>` header and calls a pure-ish **verifier** that returns `Result<VerifiedToken, AuthError>` (neverthrow). On `err` the hook replies `401` with the RFC 9728 challenge header and does not call the handler; on `ok` it falls through untouched. The verifier is the only place that touches `jose`; it is injected into `registerMcpEndpoint` as an optional dependency, so when auth is dormant no hook exists and the handler is reached directly — identical to today.

The `WWW-Authenticate` header is:

```
Bearer resource_metadata="https://music-dl.jake.cafe/.well-known/oauth-protected-resource"
```

i.e. `<public base of OAUTH_RESOURCE>` + `/.well-known/oauth-protected-resource`. The public base is derived from `OAUTH_RESOURCE`'s origin (scheme+host), so the challenge always points a client at the discovery document for this resource (RFC 9728 §5.1).

### D4 — JWT validation with `jose`: `createRemoteJWKSet` + `jwtVerify`

The verifier holds a `createRemoteJWKSet(new URL(jwksUri))` (jose caches keys and refetches on unknown `kid`, so key rotation is tolerated automatically) and runs `jwtVerify(token, jwks, { issuer: OAUTH_ISSUER })`. Beyond jose's built-in signature + `iss` + `exp`/`nbf` checks, the verifier enforces **audience** itself against `OAUTH_RESOURCE`: the token is accepted iff `OAUTH_RESOURCE` appears in the `aud` claim **or** the RFC 8707 `resource` claim **or** equals `azp` (Keycloak commonly conveys the intended resource via `aud`/`azp` depending on mapper configuration; accepting any of the three keeps the Keycloak audience-mapper setup flexible while still requiring an explicit match). Any of: no/failed signature, wrong `iss`, expired/not-yet-valid, or no audience match ⇒ a typed `AuthError` ⇒ 401. jose throws on failure; the verifier catches and maps every throw to a typed `AuthError` (`invalid_token`) — no exception escapes the edge. A malformed/missing header is `AuthError` before jose is even called.

### D5 — Discovery fetch failure is a startup fault, not a request-time surprise

When `OAUTH_JWKS_URI` is absent, discovery (`GET ${issuer}/.well-known/openid-configuration`) runs once during composition. A failure there (unreachable issuer, no `jwks_uri`) aborts startup with a fatal error — consistent with 12-factor fail-fast and with the "never silently run insecure" stance. Once constructed, per-request JWKS fetches are jose's concern and are cached; a transient JWKS fetch failure at request time maps to a 401 (invalid_token), which is the safe default (deny), and the client can retry.

## Risks / Trade-offs

- **[Keycloak audience shape uncertainty]** Exactly which claim Keycloak puts `OAUTH_RESOURCE` in (`aud` vs `azp` vs a custom `resource`) depends on the realm's mapper config, which is set outside this repo. → Accepting `aud` ∪ `resource` ∪ `azp` covers the realistic Keycloak shapes without weakening the core requirement (an explicit, exact match to this resource is still mandatory). The activation report states precisely what the validator requires so the Keycloak mapper can be configured to match.
- **[Dormant-by-default means it ships off]** The security value is zero until activated. → Intentional: the point is to land and bake the edge code cold, then flip it on by config in a separate, reversible step.
- **[Discovery coupling at startup]** Deriving JWKS from discovery adds a startup network dependency when configured. → Only when configured (dormant deploy makes no such call), and `OAUTH_JWKS_URI` provides an escape hatch that skips discovery entirely.
- **[Open `/mcp` remains open until activation]** Between this release and activation, `/mcp` is still unauthenticated on the LAN. → Acceptable and unchanged from today; public exposure via nginx is not enabled until auth is on.

## Open Questions

- Whether to require a specific scope (e.g. `mcp`) in addition to audience once activated — deferred; audience binding is the spec's floor and enough for a single-tenant connector. Additive later.
