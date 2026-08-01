## Context

The web package is the product's single interface: a SvelteKit app whose `hooks.server.ts` already funnels every server request through one `handle` (facades + logger onto `locals`), boots the module runtimes in `init`, and serves `/health` for deploy verification. There is no authentication anywhere; the app is exposed LAN-only at `:3000`. The goal is public exposure at `music.jake.cafe` behind the same nginx-ui instance that already fronts Overseerr at `download.jake.cafe` — with the Overseerr access model: sign in with Plex, and being shared on the owner's Plex server is what makes you a user.

Overseerr itself implements that model with heavyweight machinery this product doesn't need: it stores the admin's Plex token permanently, syncs a local user database from the server's share list, and layers per-user permission bitmasks and request-approval queues on top. This change deliberately takes only the access model, not the machinery — see decisions below. The design decisions here were reached in a recorded exploration/grilling session backed by a literature survey (framework prior art on auth in tests, hexagonal/GOOS/composition-root sources, CWE-489 incident history); the rationale summaries below are the durable record of that.

## Goals / Non-Goals

**Goals:**

- Gate the entire web UI behind a Plex-account login; only accounts that can see the owner's Plex server get in — and they get everything.
- Hold no server-side session state and no Plex credentials: the app's only new secret is a cookie-signing key.
- Fail closed under every misconfiguration and outage mode; no test/dev affordance that can open the gate in a shipped image.
- Cover plex.tv with the same contract-tier rigor as slskd and MusicBrainz, and keep the e2e tier able to drive the real gate and the real login routes.

**Non-Goals:**

- Per-user attribution (`requestedBy` on acquisition/import events), permission tiers, quotas, or a request-approval workflow — explicitly deferred; the two domain packages are untouched.
- Immediate session revocation (a revoked-cookie table or server-side session store). Unshare + ≤7-day expiry, or `SESSION_SECRET` rotation for everyone-now, is the accepted revocation story.
- Multi-server or non-Plex identity providers.
- The infra half (DNS, nginx server block, TLS, rate limiting, compose env) — executed in jgchk/homelab as a companion, not designed here beyond its contract with the app (`ORIGIN`, env vars).

## Decisions

**D1 — Auth is an edge concern; the domains never learn users exist.** The gate, login routes, session, and Plex check all live in `packages/web`. Facades keep their current signatures. Rationale: the access question ("may this request use the UI?") is a web-interface fact, not a business fact of acquisition or import; pulling identity into events (attribution) is a real feature with its own seam decisions, deferred deliberately rather than smuggled in as a rider.

**D2 — Share-is-approval, checked in the user's direction.** Authorization = "does the logging-in account's *own* token see a server whose `machineIdentifier` equals `PLEX_SERVER_MACHINE_ID`?" (plex.tv `/api/v2/resources`). Alternatives rejected: Overseerr's direction (admin token enumerates the share list — requires storing a powerful long-lived credential and a user sync); an env allowlist on top (machinery for a distinction Jake doesn't currently need); a local user DB (same). The user's token proves membership by itself, is held only for the duration of the login exchange, and is never persisted or logged.

**D3 — Full-page redirect PIN flow, PIN created on form POST, PIN bound to the starting browser.** Login page renders statically; submitting the form creates the PIN server-side, binds its id to the submitting browser via a short-lived HttpOnly cookie (the OAuth `state` parameter's role), and redirects the tab to `app.plex.tv/auth#?...&forwardUrl=<origin>/login/callback`; the callback refuses — before any plex.tv call — a PIN the presenting browser did not start, then checks a bound PIN once and sets the session cookie (with `secure` set explicitly, never left to a framework default keyed on `ORIGIN`). The binding closes two attacks the review surfaced: PIN hijack (plex.tv PIN ids are guessable incrementing integers and the callback is an open route) and login fixation (luring a victim to the callback URL for the attacker's approved PIN). Rejected: Overseerr's popup-and-poll (client-side popup lifecycle + poll loop + popup-blocker fallback — strictly more code and test surface for the same Plex approval screen), and PIN-on-page-render (would let drive-by GETs make us call plex.tv; the form POST also gives nginx a natural `limit_req` target).

**D4 — Stateless signed cookie, fixed 7-day expiry, logout included.** HttpOnly/Secure/SameSite=Lax cookie carrying signed claims (Plex account id, username, expiry). Fixed—not sliding—expiry is what makes cookie lifetime the re-verification cadence: every session is at most 7 days from a fresh share check, so unsharing someone actually locks them out. Sliding expiry was rejected because an active unshared user would never be re-checked; sliding-with-revalidation deferred as machinery. `SESSION_SECRET` rotation is the everyone-out-now lever. Plex being down never blocks existing sessions (nothing to check server-side); it only blocks new logins — fail closed.

**D5 — `PLEX_SERVER_MACHINE_ID` is pinned config, not discovered.** One-time `curl http://<plex-host>:32400/identity` at deploy time. Rejected: boot-time discovery via a stored admin token (adds the exact credential D2 avoids, plus a boot network dependency, to save a one-time lookup). Config validation extends the existing consolidated startup surface: missing/blank secret or machine id fails startup precisely, and a `SESSION_SECRET` shorter than 32 characters is itself a fail-startup misconfiguration — a brute-forceable HMAC secret is an open gate wearing a closed one's clothes.

**D6 — The gate decomposes into a pure session codec plus one port.** Two very different dependencies hide in "auth", and only one is external:

- *Session codec* (`$lib/server/session`): `signSession(claims, secret)` / `verifySession(cookie, secret, now)` — pure computation (HMAC + expiry over an injected clock), no I/O, no port, exhaustively unit-tested. The `handle` gate composes it the way `facadesOf()`/`loggerOf()` are composed today.
- *`PlexAccess` port*: "given this user token, does the account see machine `<id>`?" → `Result<granted | denied, PlexUnavailable>` (errors as values; an unreachable/500 plex.tv is an infra error the login page reports, never a grant). Consumed only by the login callback action. Unit tests fake *this port* in-process (GOOS: don't mock what you don't own — plex.tv's wire shapes are faked only behind our own boundary); the real adapter reads `PLEX_API_BASE_URL` from env like the slskd/MB adapters.

**D7 — Tests mint credentials; nothing permissive ships.** The survey was decisive: every mainstream ecosystem authenticates tests by minting/reusing real credentials in the test's process (Playwright storageState, Django `force_login`, Devise test mode, Spring `@WithMockUser`); none ships a production bypass. An env-selected null/fake auth strategy was rejected even though "swap adapters at the composition root" sounds hexagonal-blessed: our e2e tier boots the *shipped image* from env vars, so the selector and the permissive adapter would ship — isomorphic to `AUTH_DISABLED`, fails open, CWE-489 (and CI publishes the exact image e2e ran, with deploy env in a different repo: one env copy-paste from an open gate). Null Object is additionally wrong for guards on its own terms: "do nothing" for an authorizer means "allow everything" — inverted fail-safe defaults. Concretely:

- e2e harness passes a known `SESSION_SECRET`; a helper *imports the production `signSession`* (no reimplementation to drift) and injects the cookie via Playwright `storageState`/`addCookies`. Negative specs: no cookie and garbage cookie both land on the login page.
- A stubbed plex.tv joins the e2e third-party stubs (the existing slskd/MB stub pattern), so one journey walks the real login routes — form POST → (stub bounce standing in for app.plex.tv) → callback → cookie → gated page.
- Local dev: log in for real against plex.tv, or mint a dev cookie with the same codec via a scratch script — never a gate-off branch.
- Misconfiguration litmus applied throughout: minted cookies and a wrong `PLEX_API_BASE_URL` both fail *closed*; no configuration of the shipped image can fail open.

**D8 — plex.tv contract tier, with a scoped drift posture.** `packages/web/test/contract` follows the downloader tier to the letter: zod schemas as the single consumed-surface source of truth (PIN create, PIN check, account, resources), fixtures recorded from the real service by a recorder script, replayed against a throwaway local server in the commit gate. Two plex.tv-specific wrinkles: the recorder is *interactive* (it must pause while a human approves the PIN in a browser) and its output must scrub tokens and account PII to consumed fields — the slskd recorder lesson applied from day one. Scheduled live drift is limited to the unauthenticated PIN endpoints; the token-requiring endpoints (account, resources) stay replay-only, because a live drift job for them would need a stored long-lived Plex token — the credential this design exists to avoid. A drift break there surfaces as visible fail-closed login failures instead.

**D9 — Gate surface: everything except `/login*` and `/health`.** The `handle` gate redirects unauthenticated page requests to `/login` and refuses non-page requests. `/health` stays open (Komodo, `/ship` verification, uptime checks — no session, no side effects). Framework-served static assets are not secrets; the gate covers server routes, which is where every fact lives.

**D10 — Domain-only browsing.** `ORIGIN` (already exact-match-enforced for form actions) becomes `https://music.jake.cafe`; LAN `:3000` remains for health checks but is no longer a browsing URL. One origin, one cookie domain, one Plex `forwardUrl` — and the owner dogfoods the same login as everyone else.

## Risks / Trade-offs

- [The hop through real `app.plex.tv` is never driven in CI] → It's the one leg that isn't our code. The e2e stub walks every one of *our* login routes; the contract fixtures pin the real wire shapes; one live login verifies the leg at deploy time (same posture as slskd/MB).
- [plex.tv changes the PIN/resources API] → Contract replay pins today's shapes; PIN-endpoint drift is scheduled; token-endpoint drift surfaces as fail-closed login failures with modeled `PlexUnavailable` errors on the login page, not silent grants.
- [`SESSION_SECRET` leaks] → Anyone holding it can mint sessions. It lives only in `secrets.env` beside `SLSKD_API_KEY`; rotation is a one-line change and instantly invalidates everything. The e2e harness secret is a distinct throwaway that guards nothing.
- [Recorder captures a real Plex token or account PII in fixtures] → Recorder projects responses to consumed fields and scrubs tokens before writing, and the tier's tests assert the fixtures are scrubbed (the slskd recorder precedent).
- [Owner locks himself out via bad `PLEX_SERVER_MACHINE_ID`] → Fail-closed by design; `/health` stays reachable, fix the env var and redeploy. No in-app recovery path is intended.
- [Weekly re-login friction] → Accepted price of fixed expiry (two clicks through an already-authenticated plex.tv). If it grates, the successor is sliding-with-revalidation, a deliberate follow-up rather than a default.
- [Public exposure invites junk traffic] → Unauthenticated surface is three routes; PIN creation costs upstream calls only on POST, rate-limited at nginx (homelab side). Everything else bounces to a static login page.

## Migration Plan

Order matters only in the homelab half; the app change is a normal release.

1. Ship the app (feat, minor bump) — image published on merge as usual.
2. Homelab, before bumping the deployed tag: add `SESSION_SECRET` (generated) to `secrets.env`; add `PLEX_SERVER_MACHINE_ID` (from `/identity`) and `ORIGIN=https://music.jake.cafe` to compose; add the DNS record, nginx-ui server block + TLS + `limit_req` (Overseerr pattern).
3. Bump the compose tag; deploy via the existing webhook/Komodo path; verify `/health`, then a real Plex login, from off-LAN.
4. Rollback: revert the compose tag — sessions are stateless cookies the old image simply ignores; no data migration in either direction.

## Open Questions

None blocking. Two deliberate deferrals recorded for future changes: per-user attribution across the seam (with its own event-schema decisions), and sliding-with-revalidation sessions if weekly re-login proves annoying.
