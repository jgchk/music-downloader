## 1. Configuration and session codec

- [x] 1.1 Extend the web config surface with `SESSION_SECRET`, `PLEX_SERVER_MACHINE_ID`, and defaulted `PLEX_API_BASE_URL`; missing/blank values fail startup precisely (test-first against the existing consolidated-config validation)
- [x] 1.2 Implement the pure session codec in `$lib/server/session`: `signSession(claims, secret)` / `verifySession(cookie, secret, now)` with injected clock — valid / tampered / expired / malformed all modeled as values, exhaustively unit-tested
- [x] 1.3 Fix the 7-day expiry as a codec-level constant claim (not cookie metadata alone) so expiry survives client tampering

## 2. PlexAccess port and adapter

- [x] 2.1 Define the `PlexAccess` port in the web server layer: PIN create, PIN check, and membership check ("does this token's account see machine `<id>`?") returning `Result` values (`granted | denied`, PIN states, `PlexUnavailable`) — plus an in-memory fake for unit tests
- [x] 2.2 Define zod schemas for the consumed plex.tv surface (PIN create/check, account, resources) with adapter types derived from them
- [x] 2.3 Implement the plex.tv HTTP adapter against `PLEX_API_BASE_URL`: stable client identifier headers, schema-validated responses, violations and transport failures surfacing as modeled infrastructure errors; never logs tokens
- [x] 2.4 Wire codec and adapter in the web composition/runtime beside `facadesOf()`/`loggerOf()`

## 3. Login, callback, logout

- [x] 3.1 Build `/login`: static render (no upstream calls), form POST creates a PIN via the port and redirects to Plex's hosted auth with `forwardUrl` to the callback; modeled `PlexUnavailable` re-renders the form
- [x] 3.2 Build the callback: check the PIN once, run the membership check with the user's token, issue the session cookie (HttpOnly/Secure/SameSite=Lax) on grant; denial and unapproved/expired-PIN paths re-render login with modeled errors; the user token is dropped after the exchange (never stored, cookied, or logged)
- [x] 3.3 Build logout: form action clearing the cookie, button in the authenticated layout
- [x] 3.4 Unit/component tests for all three against the port fake, covering grant, denial, PIN failure, and infra-error paths

## 4. The gate

- [x] 4.1 Extend `hooks.server.ts` `handle`: verify the session cookie via the codec; unauthenticated page requests redirect to `/login`, non-page/action requests are refused before any facade call; `/login*` and `/health` exempt
- [x] 4.2 Unit tests for the gate minting cookies with a known test secret: valid admits, missing/expired/tampered redirect, action refusal, exemptions
- [x] 4.3 Surface the logged-in identity (username) in the layout so the logout control has a face

## 5. plex.tv contract tier

- [x] 5.1 Scaffold `packages/web/test/contract` following the downloader tier (replay against a throwaway local server in the commit gate, excluded from unit coverage)
- [x] 5.2 Write the interactive recorder script: drives a real PIN exchange (pausing for human approval in a browser), records the consumed operations, projects to consumed fields and scrubs all tokens/PII before writing; fixtures carry provenance
- [x] 5.3 Record fixtures from real plex.tv; add replay tests validating adapter requests and fixture conformance to the schemas
- [x] 5.4 Add fixture-scrub assertions (no token, no unconsumed account fields anywhere in recorded artifacts)
- [x] 5.5 Extend scheduled drift only for the unauthenticated PIN operations; document the replay-only posture for token-requiring operations

## 6. E2E tier

- [ ] 6.1 Harness: pass a throwaway `SESSION_SECRET` into the container env; add a `mintSessionCookie()` helper that imports the production codec and installs cookies via Playwright storage state
- [ ] 6.2 Convert existing browser journeys to run authenticated via the minted cookie
- [ ] 6.3 Gate specs from outside: no cookie → login page, garbage cookie → login page, `/health` answers with no session
- [ ] 6.4 Add the plex.tv stub to the harness stubs (PIN create/check, resources; contract-conforming payloads) wired via `PLEX_API_BASE_URL`
- [ ] 6.5 Login-journey spec against the stub: form POST → redirect contract → callback → session → gated page; plus the denial path staying outside
- [ ] 6.6 Verify the degraded-boot phase still passes with plex.tv unreachable (existing sessions unaffected; login fails closed)

## 7. Gate, docs, release

- [ ] 7.1 Update README/env documentation for the new variables and the domain-only `ORIGIN` posture
- [ ] 7.2 `pnpm check` green (format, lint, typecheck, build, 100% merged coverage) and `pnpm test:e2e` green
- [ ] 7.3 Version prep (feat → minor), PR, merge on green

## 8. Homelab companion (jgchk/homelab repo) and live verification

- [ ] 8.1 Generate `SESSION_SECRET` into `secrets.env`; read the machine id from `http://192.168.1.238:32400/identity`; set `PLEX_SERVER_MACHINE_ID` and `ORIGIN=https://music.jake.cafe` in compose
- [ ] 8.2 DNS record + nginx-ui server block with TLS for `music.jake.cafe` → flight:3000, `limit_req` on the login routes (Overseerr pattern)
- [ ] 8.3 Bump the compose image tag, deploy, verify `/health`, then a real Plex login (grant) and an unshared-account denial from off-LAN
