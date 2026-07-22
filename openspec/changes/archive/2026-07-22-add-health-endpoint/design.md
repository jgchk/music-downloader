# Design — add-health-endpoint

## Context

The composed process boots both module runtimes in SvelteKit's `init` server hook (`packages/web/src/hooks.server.ts` → `bootRuntimes` in `$lib/server/runtime.ts`) and only then serves requests; `handle` puts the module facades on `event.locals`. Facades are wire-shaped command/query surfaces over DTOs — they carry no operational-health accessor. The v3.0.0 merge removed the Fastify HTTP layer that used to answer `/health` and expose version. We need a machine-readable probe back, at the right layer (interface), without leaking module internals or violating the dependency rule.

## Goals / Non-Goals

**Goals**

- A stable `GET /health` HTTP endpoint returning `200` + JSON on a ready process; a non-2xx signal when degraded.
- Report the live app version so "which version is deployed?" is answerable over HTTP by an automated check.
- Report per-module runtime readiness for `downloader` and `importer`, honestly, without event-store scans or domain I/O.
- Stay additive (no breaking change), test-first, within the existing 100% coverage gate.

**Non-Goals**

- Re-exposing an OpenAPI/Swagger document or a separate `/version` route (deferred; version rides on `/health`).
- Authentication for the endpoint (the UI is unauthenticated today; unchanged here).
- Deep diagnostics (metrics, event-store lag numbers, dependency pings to slskd/beets). The snapshot is a boolean-ish readiness, not a metrics surface.

## Decisions

### D1 — Path and verb: `GET /health`

A single `+server.ts` at `/health` exposing `GET`. Chosen over `/api/health` because the SvelteKit app has no `/api` namespace today and operators/uptime tooling conventionally probe `/health`; the merge history and homelab notes reference `/health`. `/api/health` is available as a later alias if a public `/api` surface ever emerges.

### D2 — The endpoint is a readiness probe, and readiness ≈ boot gate + live module health

`init` awaits `bootRuntimes`, and a boot failure throws (the process refuses to serve a half-booted daemon). So any reachable `/health` response already implies "both runtimes booted." The endpoint therefore reports **readiness**, defined as: booted AND each module runtime currently reporting itself healthy. Pure liveness ("is the port answering") is subsumed — a 5xx or a dead socket already tells a probe the process is unhealthy. We do not add a separate `/health/live` vs `/health/ready` split; one endpoint with a status body covers both operator needs (up? which version?) at lower surface area.

### D3 — Status codes: 200 when `ok`, 503 when `degraded`

`200` with `status: "ok"` when every module snapshot is healthy; `503` with `status: "degraded"` when any booted module reports unhealthy. `503` (not `500`) signals "temporarily not ready" to load balancers and uptime checks — the process is alive but should not be treated as fully serving. The body always enumerates per-module status so a `degraded` response names the culprit.

### D4 — Module runtimes expose a synchronous, side-effect-free readiness snapshot

The web BFF must read module health without importing module internals or touching event stores. Each module runtime (the object `createXRuntime` returns) gains a small readiness accessor returning a plain value (e.g. `{ status: 'up' | 'down' }`, errors-as-values friendly — no throw). It is read from in-memory runtime state (are the store, reactors, and seam subscription live / not halted-on-poison), not computed by a query against the event store. This keeps the probe cheap (safe to hit every few seconds) and keeps the dependency rule intact: the route reads a runtime snapshot surfaced through `$lib/server`, the domain stays pure.

### D5 — Version comes from the workspace `package.json`, resolved server-side

The app version is read once at composition/boot from the root/web `package.json` (build-time inlined or read at startup), surfaced through `$lib/server`, and echoed in the payload. No environment variable is required for version; it is the shipped artifact's version. (Config still comes from the environment for everything that is genuinely configuration — the version is not.)

### D6 — Payload contract

```json
{
  "status": "ok",
  "version": "3.2.0",
  "modules": {
    "downloader": { "status": "up" },
    "importer": { "status": "up" }
  }
}
```

`status` ∈ {`ok`, `degraded`}. Each module `status` ∈ {`up`, `down`}. The shape is additive-friendly: fields may be added later (e.g. `uptime`, `checkedAt`) without breaking consumers. This is the contract the endpoint's contract/route tests pin.

### D7 — Errors as values

Reading the snapshot and version returns values, not exceptions. The route composes them into a `Response`; there is no `try/catch` swallowing domain errors. If a snapshot read itself cannot be obtained (should not happen post-boot), that maps to `degraded`/`503`, modeled explicitly rather than thrown.

## Risks / Trade-offs

- **Shallow readiness first.** The initial snapshot reflects boot + gross runtime liveness, not deep dependency health (slskd/beets reachability). That is deliberate — a health probe that pings third parties becomes a flakiness amplifier and a DoS vector. Deeper signals can be added additively behind the same contract if an operational need appears.
- **Runtime surface growth.** Adding a readiness accessor widens the module runtime surface slightly. Mitigated by keeping it a tiny read-only value with no new dependencies; it does not touch the facade (the wire contract) at all.
- **Version-source coupling.** Reading `package.json` at build/boot ties the reported version to the artifact; a mis-pinned build would misreport. Acceptable — that is precisely the signal operators want (the artifact's own version).

## Migration Plan

Purely additive; no migration. Ship in v3.2.0. Once live, homelab/Komodo verification and uptime checks re-point at `GET /health`; the runbook note about `docker inspect`-only verification can be retired.

## Open Questions

- **Path**: `/health` (this design) vs `/api/health` — confirm no downstream tooling already hardcodes a different path from the pre-merge Fastify surface.
- **Scope of "up"**: is booted-and-not-halted sufficient for v1, or should `down` also cover a seam subscription that is parked on a poison event / a poller that has not ticked within a threshold? (Design leans to the former for v1, additive later.)
- **503 vs 200-with-degraded-body**: some uptime tools treat any non-2xx as "down" and cannot read the body. 503 is chosen so those tools alert; confirm the homelab uptime check reads status codes, not just reachability.
- **Should the app version also be surfaced in the UI** (footer) now that it is resolved server-side? Out of scope here but a cheap follow-on.
