# Tasks — add-health-endpoint

Test-first throughout: every item writes a failing test (red) before the production line that makes it pass (green), then refactors. No production code lands without a failing test first. All new code sits under the web package's merged 100% coverage gate.

## 1. Module runtime readiness snapshot

- [x] 1.1 (red) Write a failing test in each module runtime's suite asserting `createXRuntime(...)` returns a runtime exposing a synchronous readiness snapshot that reports the module up when store/reactors/seam subscription are live — value returned, no throw
- [x] 1.2 (green) Add the minimal readiness accessor to each module runtime, reading in-memory runtime state only; no event-store scan, no I/O, errors-as-values
- [x] 1.3 (red) Write a failing test asserting the snapshot reports the module down when its seam subscription is halted/parked, without throwing
- [x] 1.4 (green) Implement the down path from runtime state; refactor both modules' accessors to a shared shape if it stays lint-legal (no shared kernel)
- [x] 1.5 (red) Write a failing test asserting repeated reads are side-effect free (no store mutation/scan, no I/O) — pin the no-side-effects guarantee
- [x] 1.6 (green) Confirm the accessor satisfies it; keep it a pure read of a runtime field

## 2. Server-layer wiring (`$lib/server`)

- [x] 2.1 (red) Write a failing test in the web package asserting a server-layer accessor exposes each booted runtime's readiness snapshot and the app version through the composition seam, without leaking module internals to routes
- [x] 2.2 (green) Thread the readiness snapshots and the app version (read from the shipped package version at boot) through `$lib/server/runtime.ts` into a readiness surface routes can read from `locals`/server helpers
- [x] 2.3 (red) Write a failing test asserting the version reported matches the shipped package version (not an env var)
- [x] 2.4 (green) Wire the version source; confirm the lint boundary (routes import server-layer only, no module internals) still holds

## 3. `GET /health` route

- [x] 3.1 (red) Write a failing server-route test: `GET /health` on an all-healthy process returns `200`, `status: "ok"`, the version, and `modules.downloader.status`/`modules.importer.status` both `up`
- [x] 3.2 (green) Add `packages/web/src/routes/health/+server.ts` composing the readiness surface into a `Response`; errors-as-values, no `try/catch` swallowing
- [x] 3.3 (red) Write a failing test: when a booted module reports unhealthy, `GET /health` returns `503`, `status: "degraded"`, and the body names the down module
- [x] 3.4 (green) Implement the degraded/`503` branch
- [x] 3.5 (red) Write a failing test asserting the route performs no event-store scan, no third-party call, and no module-internal import (reads the server-layer snapshot only)
- [x] 3.6 (green) Satisfy it; refactor the route to its simplest form

## 4. Contract and gate

- [x] 4.1 Pin the `/health` JSON contract (overall `status` ∈ {ok, degraded}; per-module `status` ∈ {up, down}; `version` present) in the web route/contract tests; assert the shape is additive-stable
- [x] 4.2 Verify the merged web coverage report counts the new route and readiness code at 100% with no new carve-out; run `pnpm check` (format → lint → typecheck → build → test w/ coverage) green
- [ ] 4.3 (optional, threshold-free) Extend the Playwright/e2e smoke to hit `GET /health` on the running adapter-node build and assert `200` + `ok` + version — DEFERRED: booting the composed adapter-node process requires live slskd + a valid beets bridge (boot fails fast otherwise), i.e. the `test:e2e` infra tier, not available in this workspace run. The build verifiably inlines the version (`3.0.1` present in `build/server`, no leftover `__APP_VERSION__`), and the route's ok/degraded paths are covered by unit tests.

## 5. Release note

- [ ] 5.1 Note the additive, non-breaking minor bump (v3.1.0) in the changelog at release time; call out the re-added `GET /health` probe for deploy/uptime verification — DEFERRED to release: the changelog + version bump are produced by `version:prep`/`commit-and-tag-version` at release time, not hand-edited now.
