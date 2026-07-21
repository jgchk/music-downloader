# Merge downloader + importer into a modular monolith

## Why

The downloader and importer are two bounded contexts deployed as two repos, two pipelines, and two services whose only integration is two messages (`acquisition.fulfilled` outbound, a release verdict back) carried over webhook machinery — HMAC signing, raw-body verification, delivery dedupe, contract-drift CI — between processes that always run on the same machine. The coupling that matters is already managed by contracts (tolerant readers, ACLs, idempotent deciders), not by the process boundary, so the multi-service topology is pure operational overhead. Separately, the MCP interface has proven a dead end for its purpose (hosted models refuse music-download tools on content grounds, regardless of transport or auth), and the product needs a real user interface: a single *arr-style web UI covering search → download → import → library.

## What Changes

- **BREAKING** — the two repos merge into one pnpm-workspace monorepo (this repo), one process, one deploy, shipped as **v3.0.0**. The `music-importer` history is merged in; its repo is retired.
- Two bounded-context packages (`downloader`, `importer`) each keep their own domain/application/adapters layers and their **own SQLite event store file**. No shared kernel.
- The webhook seam is replaced by an **in-process durable catch-up subscription**: the importer tails the downloader's event store by global position with a consumer-owned checkpoint; semantics are unchanged (async, at-least-once, ordered, tolerant readers, ACL translation, idempotent convergence). All webhook transport machinery and the contract-drift workflow are deleted.
- **BREAKING** — the MCP interface and the standalone HTTP API are removed (nothing external consumes them; existing Claude connectors stop working, accepted). Fastify leaves the stack.
- Modules expose **wire-shaped facades** (commands/queries over serializable DTOs, zod-validated, errors as values) — the only lint-legal import for interface packages, enforced like the dependency rule. The facade is the API; HTTP/CLI/MCP become deferrable transport bindings.
- A **SvelteKit web UI package** (BFF: server routes call facades in-process) becomes the sole interface, at functional parity with today's MCP tools: submit/cancel acquisitions, observe progress, resolve import reviews. The process boots via SvelteKit `adapter-node` with a custom entry that starts the module runtimes (reactors, pollers) — a daemon that serves pages.
- The 100% coverage gate extends to the UI package via Vitest 4 Browser Mode (three-project architecture: node/ssr/browser, merged root coverage), with small named carve-outs; Playwright e2e stays threshold-free.
- OpenSpec trees merge: importer capabilities are adopted into this repo's `openspec/specs/`; name collisions (`outbound-events`, `public-api`) resolve with module prefixes; every adopted spec notes its module of origin.
- Deployment collapses: one GHCR image, one Komodo stack; webhook secrets and the importer stack are retired; both event-store files carry over.

## Capabilities

### New Capabilities

- `module-architecture`: the workspace layout, module boundary rules, wire-shaped facade contracts, and lint enforcement (facade-only imports, no cross-module internals, no shared kernel).
- `cross-module-delivery`: durable in-process event delivery between module stores — catch-up subscription, checkpoint-with-effects atomicity, notify-then-poll loop, startup catch-up, poison-event policy.
- `web-ui`: the SvelteKit BFF interface — acquisition submission/cancellation, progress observation, import review resolution — and its testing/coverage regime.

### Modified Capabilities

- `public-api` (downloader): **retired** — HTTP API and MCP endpoints removed; the interface surface becomes the web BFF over facades.
- `outbound-events` (downloader): webhook delivery requirements replaced by the in-process subscription feed; producer-owned event schemas remain the module contract.
- `library-import` (downloader): external verdict intake arrives via the subscription seam instead of the verdict webhook.
- `runtime-baseline` (downloader): single-process composition — SvelteKit entry boots both module runtimes; consolidated environment configuration.
- `release-pipeline` (downloader): monorepo gate, single image/release, v3.0.0 epoch.
- `out-of-process-e2e` (downloader): the e2e harness exercises the full loop (intent → library) against the single service.
- `import-management` (importer, adopted): intake consumes the subscription instead of the intake webhook.
- `match-review` (importer, adopted): review resolution moves from MCP tool to web UI flow.
- `beets-bridge` (importer, adopted): unchanged requirements, adopted into the monorepo.
- `outbound-events` (importer, adopted as `importer-outbound-events`): verdict publication moves from webhook to the subscription feed the downloader consumes.
- `public-api` (importer): **retired** — HTTP/MCP surface removed with the merge.

## Impact

- **Repos/VCS**: `music-importer` history merged into this repo via jj; importer repo archived afterward.
- **CI/CD**: importer pipeline and `contract-drift.yml` deleted; one pipeline runs the full gate (format → lint → typecheck → build → test w/ merged coverage) across the workspace.
- **Dependencies**: Fastify and MCP SDK removed; SvelteKit, `adapter-node`, Vitest 4 Browser Mode stack (`@vitest/browser-playwright`, `vitest-browser-svelte`) added.
- **Deployment**: `jgchk/homelab` stacks collapse from two to one; env vars for webhook secrets/peer URLs removed; both SQLite volumes retained.
- **Consumers**: Claude Code MCP connectors (downloader + importer) stop working — accepted; the web UI is the replacement. Nothing else hits either HTTP surface.
- **Deferred explicitly**: web UI auth (eventual Plex-account sign-in, Overseerr-style), any re-added HTTP API/CLI/MCP transport bindings.
