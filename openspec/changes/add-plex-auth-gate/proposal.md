## Why

The web UI is the product's only interface, and today it is LAN-only and wholly unauthenticated — anyone who can reach `:3000` can submit downloads, cancel acquisitions, and resolve import reviews. Jake wants the app reachable from anywhere at `music.jake.cafe` (the Overseerr pattern already running on the same host), which makes an access gate a precondition: sign in with a Plex account, and only accounts Jake has shared his Plex server with may do anything at all.

## What Changes

- **Plex-authenticated access gate** in the web package: every route requires a valid session except the login flow and `/health` (which stays open for deploy verification and monitoring).
- **Login via the Plex PIN flow, full-page redirect** (no popup/polling): the login form POST creates a PIN, the browser is sent to `app.plex.tv` and bounced back to a callback, which verifies the PIN once server-side.
- **Share-is-approval, binary access**: authorization = "does this account's own Plex token see the owner's server (`PLEX_SERVER_MACHINE_ID`)?" No user database, no allowlist, no permission tiers, no request-approval queue. The app holds no Plex credentials — only the user's short-lived token during login, dropped after the check.
- **Stateless signed session cookie, fixed 7-day expiry** — nothing stored server-side. Revocation = unshare the Plex server (effective within 7 days) or rotate `SESSION_SECRET` (immediate, everyone). Logout included.
- **plex.tv joins the consumed-API contract tier**: zod schemas, token-scrubbed recorded fixtures, replay tests, recorder script — the slskd/MusicBrainz pattern.
- **E2E tier learns auth**: the harness mints session cookies with the production codec (Playwright `storageState`), negative specs cover missing/garbage cookies, and a stubbed plex.tv lets one journey walk the real login routes. No auth-disable branch ships in the image.
- **Deferred, explicitly**: per-user attribution (`requestedBy` on events), permission tiers, immediate cookie revocation state. Both domain packages are untouched — this is an edge-only change.
- **Companion infra work (jgchk/homelab repo, not tasks here)**: DNS + nginx-ui server block with TLS for `music.jake.cafe` → flight:3000, `limit_req` on the login routes, compose gains `ORIGIN=https://music.jake.cafe`, `SESSION_SECRET`, `PLEX_SERVER_MACHINE_ID`.

## Capabilities

### New Capabilities

- `web-access-control`: who may use the web UI and how they prove it — the Plex PIN login flow, the share-is-approval authorization check, the stateless session (issue/verify/expire/logout), the route gate and its exemptions (`/login*`, `/health`), and the no-credential-retention and fail-closed properties.

### Modified Capabilities

- `external-api-contracts`: plex.tv becomes a third consumed external API — its consumed surface (PIN create/check, account, resources) gets pinned schemas, recorded token-scrubbed fixtures, and replay coverage like slskd and MusicBrainz.
- `out-of-process-e2e`: the browser phase must authenticate (harness-minted session via the production codec) and prove the gate (unauthenticated → login); plex.tv joins the stubbed third parties so the login journey is walked end-to-end against the real routes.

## Impact

- **Code**: `packages/web` only — `hooks.server.ts` (gate), new `/login`, `/login/callback`, logout action, a pure session codec and a `PlexAccess` port in `$lib/server`, its plex.tv adapter, wiring in the web composition/runtime. Downloader and importer packages: no changes.
- **Tests**: new unit/component coverage under the 100% gate; new contract tier for plex.tv (`packages/web/test/contract` following the downloader pattern); e2e harness changes (`test/e2e`) — session-mint helper importing the production codec, plex.tv stub, gate specs.
- **Config (new env)**: `SESSION_SECRET` (secret), `PLEX_SERVER_MACHINE_ID`, `PLEX_API_BASE_URL` (defaulted; overridden in tiers). `ORIGIN` changes value in deploy (homelab compose). Startup validation extends the existing consolidated-config surface.
- **Operational**: browsing moves domain-only (`ORIGIN` is exact-match); LAN `:3000` remains for health checks, not browsing. plex.tv outage blocks new logins, never existing sessions. Deploy-time: one-time `curl http://<plex-host>:32400/identity` to pin the machine ID.
- **Versioning**: additive feature — minor bump (feat). No public-contract breakage; no event-schema changes.
