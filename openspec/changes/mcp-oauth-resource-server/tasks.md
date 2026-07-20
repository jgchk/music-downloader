## 1. Config: the OAuth resource-server block (config-dormant, fail-loud)

- [x] 1.1 Write failing `config.test.ts` cases: unset `OAUTH_ISSUER` ⇒ `config.oauth` undefined (dormant); `OAUTH_ISSUER` set without `OAUTH_RESOURCE` ⇒ `MissingVar` `OAUTH_RESOURCE`; both set ⇒ `{ issuer, resource, jwksUri: undefined }`; `OAUTH_JWKS_URI` set ⇒ carried through; blank issuer treated as absent; invalid issuer/resource URL ⇒ typed error.
- [x] 1.2 Implement the `oauth` block in `config.ts` (`AppConfig['oauth']`, new `ConfigError` variants as needed) following the `verdictWebhook` dormant precedent.

## 2. The bearer verifier (JWKS-backed JWT validation as typed values)

- [x] 2.1 Write failing unit tests for the verifier: valid token (correct sig/iss/exp, `aud` includes resource) ⇒ `ok`; missing/malformed `Authorization` header ⇒ `err` `invalid_request`/`invalid_token`; bad signature ⇒ `err`; expired ⇒ `err`; wrong `iss` ⇒ `err`; audience only in `resource`/`azp` ⇒ `ok`; no audience match ⇒ `err`. Use a locally-generated JWKS (jose `generateKeyPair` + `SignJWT`) and a stubbed key source so tests are offline and deterministic.
- [x] 2.2 Implement the verifier: `jose` `createRemoteJWKSet` + `jwtVerify({ issuer })`, then the audience check against the resource (`aud` ∪ `resource` ∪ `azp`), catching every jose throw into a typed `AuthError`. Return `Result<VerifiedToken, AuthError>`.

## 3. The MCP auth edge: metadata route + `/mcp` preHandler

- [x] 3.1 Write failing inject tests (via `buildHttpApp`): unconfigured ⇒ `/mcp` reachable unauthenticated AND `/.well-known/oauth-protected-resource` is 404 (dormant); configured ⇒ metadata route returns the exact RFC 9728 JSON body; configured + no/invalid/expired/wrong-audience bearer on `POST /mcp` ⇒ 401 with `WWW-Authenticate: Bearer resource_metadata="…/.well-known/oauth-protected-resource"`; configured + valid bearer ⇒ request reaches the MCP handler (e.g. an initialize/list succeeds).
- [x] 3.2 Implement: `registerMcpEndpoint` gains an optional auth config (verifier + resource + issuer + metadata-url); when present, register the well-known route and attach a `preHandler` on `/mcp` that 401s with the challenge on verifier `err`; when absent, behavior is byte-for-byte unchanged. Keep metadata + `/mcp` off the OpenAPI document (`hide: true`).

## 4. Composition + fidelity

- [x] 4.1 Wire it in `composition/index.ts`: build the verifier from `config.oauth` (discover JWKS from the issuer when `OAUTH_JWKS_URI` is absent, fail startup on discovery failure), thread the auth config through `buildHttpApp` → `registerMcpEndpoint`; add a startup log line stating MCP auth active vs dormant. Promote `jose` to a direct dependency in `package.json`.
- [x] 4.2 In-process e2e (or extend the MCP-over-HTTP suite): with auth configured against a local test JWKS, a valid signed token completes an MCP call and an unauthenticated call is refused 401; with auth unconfigured, the existing open-`/mcp` behavior is unchanged.
- [x] 4.3 `pnpm check` green (format, lint, typecheck, build, 100% coverage, contract, release); sync the `public-api` delta into `openspec/specs` on archive; doc comments on the verifier and the dormant-by-default edge.
