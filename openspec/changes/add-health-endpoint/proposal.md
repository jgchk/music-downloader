# Re-add a health endpoint to the web interface

## Why

The v3.0.0 merge collapsed the two services into one modular monolith behind a single SvelteKit app, and in doing so it deleted the per-module Fastify HTTP APIs — which is where health, version, and OpenAPI lived. The SvelteKit app now serves **UI routes only**: `/`, `/acquisitions`, and `/reviews` all answer 200, but there is no machine-readable liveness/readiness endpoint and no version endpoint. Verified against the live instance: `GET /health`, `/api/health`, `/version`, `/docs/json`, and `/openapi.json` all return 404.

The operational cost is real. Deploy verification, uptime monitoring, and the everyday question "which version is actually live?" all previously leaned on an HTTP probe. Today an operator can only confirm a deploy by reading the git compose pin or running `docker inspect` on the host — clumsy, out-of-band, and impossible for an automated uptime check to consume. Komodo redeploy verification and any external health check have no endpoint to hit.

The composition is also well-suited to a *readiness* probe, not just liveness: SvelteKit's `init` hook awaits `bootRuntimes` before the app serves any request, so both module runtimes are booted before `/health` can answer. That boot gate is a guarantee we can report on — and mid-flight degradation (a halted seam subscription, a wedged poller) is exactly the kind of thing a readiness endpoint should expose but nothing currently does.

## What Changes

- Add a SvelteKit server route (`+server.ts`) at `GET /health` that returns `200` and a JSON body on success. The payload reports an overall `status`, the app `version` (from the workspace `package.json`), and per-module runtime readiness for `downloader` and `importer`.
- Define **readiness semantics**: the endpoint is a readiness probe. It reports `ok` (200) when both module runtimes are booted and healthy, and `degraded` (503) when a booted runtime reports itself unhealthy. Because the boot gate refuses to serve a half-booted process, a reachable `/health` already implies "booted"; the endpoint's added value over raw reachability is version reporting and post-boot per-module health.
- Add a cheap **readiness snapshot** to each module runtime surface (`runtime-baseline`): a synchronous, side-effect-free query the web BFF can read to answer `/health` without scanning event stores or performing domain I/O. The route is an interface-layer concern that reads this snapshot; the domain stays pure and dependencies point inward.
- This is **purely additive**: a new endpoint plus a new read-only runtime query. No existing route, facade, or contract changes. Per api-compatibility this is a **minor, non-breaking** change (targets **v3.1.0**).

## Capabilities

### Modified Capabilities

- `web-ui`: adds the health/readiness endpoint requirement — the `GET /health` server route, its JSON contract, its status-code semantics, and its coverage obligation under the existing UI gate.
- `runtime-baseline`: adds the requirement that each module runtime exposes a synchronous, side-effect-free readiness snapshot the composed interface can read, without cross-module coupling or event-store scans.

## Impact

- **Code**: one new `packages/web/src/routes/health/+server.ts`; a readiness accessor threaded from the module runtimes through `$lib/server` (runtime/facades). No changes to domain or application layers.
- **Contracts/compat**: additive only; new `/health` endpoint and new runtime query. No breaking change; minor version bump to v3.1.0.
- **Ops**: Komodo redeploy verification, uptime checks, and "which version is live?" get a stable HTTP probe again. Monitoring can alert on `503`/`degraded`.
- **Testing**: new route and readiness snapshot land test-first under the web package's merged 100% coverage gate (server + ssr projects); no threshold carve-out required.
- **Deferred explicitly**: re-exposing an OpenAPI document (`/docs/json`) and a standalone `/version` endpoint — `/health` carries the version, so a separate version route is unnecessary for now; the web UI auth story is unchanged (the endpoint is unauthenticated, consistent with the rest of the UI today).
