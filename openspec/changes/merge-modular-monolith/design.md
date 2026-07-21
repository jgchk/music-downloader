# Design — merge-modular-monolith

## Context

Two sibling event-sourced services share one constitution, one machine, and a two-message integration seam (`acquisition.fulfilled` → importer; release verdict → downloader) carried over Standard-Webhooks-style HTTP (HMAC over raw body, timestamp windows, delivery dedupe, retries), with consumer-owned tolerant readers and ACL translation on each side and idempotent convergence in the deciders. Each service owns a SQLite event store (better-sqlite3, WAL). Interfaces today: HTTP API + MCP (Fastify) on each service; nothing external consumes either. The literature review behind the seam design (catch-up subscriptions, outbox, checkpointing — Richardson, Grzybek, Dudycz/Emmett, Eventide/MessageDB, Marten async daemon, Graphile Worker) and the UI-coverage review (Vitest 4 Browser Mode) were done 2026-07-21; their conclusions are folded in below.

## Goals / Non-Goals

**Goals:**

- One repo, one process, one deploy (*arr-style product), with the two bounded contexts intact and extraction kept mechanical.
- Replace the webhook transport with an in-process seam that preserves today's semantics exactly: async, at-least-once, per-stream ordered, durable across crashes, idempotently consumed.
- Interfaces become cross-functional packages over wire-shaped module facades; ship a functional-parity SvelteKit web UI as the only interface.
- Keep every constitutional non-negotiable, including the 100% coverage gate, across all packages — UI included.

**Non-Goals:**

- Feature expansion of the UI beyond parity (search/browse enrichment, library management UX come later).
- Auth/remote access (deferred: Plex-account sign-in, Overseerr-style).
- Any HTTP API, CLI, or MCP transport binding (deferred until a real second consumer exists).
- Merging the two event stores or introducing cross-store transactions (explicitly rejected — see Decisions).
- Renaming the product (stays `music-downloader` for now).

## Decisions

### D1 — Workspace shape: two context packages, interface packages above, no shared kernel

pnpm workspace: `packages/downloader` and `packages/importer` (each with its own `domain/application/adapters` layers and its own SQLite store), `packages/web` (SvelteKit BFF), and a composition entry that wires everything. No shared package; small types are duplicated rather than coupled. *Alternative considered:* a `shared-kernel` package for IDs/paths — rejected; every shared type is a coupling point that makes extraction non-mechanical, and the duplication cost observed at the current seam is near zero.

### D2 — Module facades are wire-shaped and are the only legal import from interfaces

Each context exports one facade module: commands and queries over plain serializable DTOs, zod schemas at the boundary, errors as modeled values per the failure taxonomy. Lint enforces (same mechanism as the dependency rule): interface packages may import a module's facade entry point only; modules may not import each other's internals at all. Rationale: the facade IS the public API — a later HTTP/CLI/MCP binding is a mechanical transport projection of it, and extraction of a module is "reimplement the facade over HTTP", which wire-shaped DTOs guarantee stays possible. *Alternative:* keep a standalone HTTP API the BFF calls over localhost — rejected: proximity/aggregation benefits of a BFF hold in-process too; a frozen public contract with zero external consumers inverts the point of the api-compatibility rule.

### D3 — Cross-module seam: catch-up subscription over the producer's store; no outbox

The producer's event store *is* the outbox (event-sourced producers have no dual-write problem — Richardson's ES note; Comartin's "your event stream is a message queue"; the Grzybek/Jovanović outbox+inbox prescription applies to state-stored modules and dissolves here). The importer tails the downloader's store (and vice versa for verdicts) reading `WHERE global_position > ?checkpoint ORDER BY global_position LIMIT ?batch`. SQLite's single-writer property makes global positions gapless and monotonic — none of Marten's high-water-mark/tombstone machinery is needed. Consumer-owned tolerant readers and ACL translation are kept verbatim from the webhook era; the transport changes, the contract does not. Integration events remain producer-owned schemas with frozen fixtures; the contract tests move in-repo (cross-package) and `contract-drift.yml` dies.

### D4 — Checkpoint lives in the consumer's file and advances atomically with effects

Per-subscription named checkpoint row in the consumer's own SQLite file; the checkpoint advances only **after** the batch's effects have durably committed in that same store — it lags, never leads. (Implementation note, recorded at review: the design's original one-transaction form was not implementable over the async use-case pipeline — better-sqlite3 transactions are synchronous closures — so the crash window between effects and checkpoint yields redelivery, which the idempotent deciders converge; the observable end state is identical. EventStoreDB/Dudycz's atomic-pair remains the ideal this approximates; Emmett processors own their checkpoints the same way.) Checkpoints are named per subscription (future subscribers get independent progress) and resettable (replay/rebuild story). *Alternative:* Eventide-style interval-batched position writes — rejected; atomic per-batch commit is free in-process and shrinks the redelivery window to zero in the normal case.

### D5 — Delivery loop: notify-then-poll, poll is the guarantee

After the producer's transaction commits, it fires an in-process wakeup (EventEmitter) carrying only "new events at ≤ position N" — a lossy latency hint, never the payload. The subscription loop: on startup always poll from checkpoint (crash catch-up); drain in batches (~100, better-sqlite3 is synchronous — modest batches, yield between them); then sleep on the wakeup with a seconds-scale fallback poll as the actual durability guarantee (Graphile Worker's LISTEN/NOTIFY-plus-poll model). *Alternative:* pure polling (Eventide, Solid Queue) — acceptable but leaves seconds of avoidable latency; the hybrid costs one EventEmitter.

### D6 — Two files, no cross-file atomicity — the checkpoint always lags

Cross-SQLite-file atomicity is impossible under WAL (per SQLite's own ATTACH docs), so no design step may require it. Discipline: producer commits to file A; consumer later commits effects+checkpoint to file B; the checkpoint is the only cross-file coordination and it always lags, never leads — worst case is redelivery, absorbed by the idempotent deciders. Never ATTACH the two files into one connection. Connection settings on both: WAL, `busy_timeout` 5–10s, `synchronous=NORMAL`, short transactions, one connection per purpose.

### D7 — Poison events: bounded retries, then per-subscription park-or-halt

Bounded in-place retries with backoff; on exhaustion, the subscription's declared policy decides: **halt** (stop that subscription, alert — correct where order is workflow-critical, e.g. verdict intake) or **park** (dead-letter row in the consumer's file with position + error, advance past — progress over order). Policy is explicit configuration per subscription, mirroring Marten's configurable error handling rather than an implicit default.

### D8 — Process shape: SvelteKit `adapter-node` custom entry hosts the daemon

Fastify is removed. The composition root becomes the boot step of the web process: both module runtimes — event stores, subscriptions, reactors, slskd polling, timers — are wired before the SvelteKit handler accepts any request. (Implementation note, recorded at review: realized as module runtime factories `@music/*/runtime` composed in the web package's `$lib/server` and awaited in SvelteKit's `init` hook, with shutdown on `sveltekit:shutdown` — adapter-node's own entry thereby boots the daemon before listening; no hand-rolled server wrapper was needed. The 'runtimes before interface' guarantee is spec-tested.) The process is a daemon that serves pages. Dev runs Vite's dev server with the facades wired in via SSR; prod runs the composed `adapter-node` build. *Alternative:* Fastify hosting SvelteKit's handler as middleware — rejected: with webhooks and MCP gone, Fastify had no remaining job; keeping it would be a framework with zero routes.

### D9 — BFF: SvelteKit server routes call facades in-process; no business orchestration in interfaces

`+page.server.ts` loads and form actions call module facades directly (the BFF may read both modules to compose a page and dispatch to either), but cross-module *workflow* — "when fulfilled, import" — lives only on the event seam. The moment an interface sequences a business flow across facades, extraction breaks; lint can't fully catch this, review must.

### D10 — UI testing: three vitest projects, one merged 100% gate; Playwright e2e threshold-free

Vitest 4 architecture (sveltest reference): projects `server` (node: loads, actions, facade wiring), `ssr` (node: render-to-string smokes), `client` (Browser Mode, Chromium-only via Playwright provider: `*.svelte.test.ts` with `vitest-browser-svelte`). Coverage is root-level and merges across projects against one `thresholds: {100: true}` block; provider v8 (AST-remapped in v4, Chromium-only — cross-browser confidence belongs to e2e). `coverage.include` MUST list source globs (v4 no longer reports untouched files by default — silent hole in a 100% gate otherwise); `excludeAfterRemap: true`. Carve-outs, named and bounded: `app.html`, `*.d.ts`, generated `.svelte-kit/`, trivial hooks, test/setup files; components, layouts, pages stay in scope; `/* v8 ignore */` pragmas permitted for compiler-emitted phantom branches, each with a comment. Playwright e2e lives in a separate non-gating CI job. Server-only module boundaries (`$env/static/private` etc. failing client builds) are treated as a feature — they mechanically enforce BFF layering.

### D11 — Path re-rooting stays

Event payload locations remain sender-namespaced and are re-rooted at intake (STAGING_ROOT), even though both modules now share one filesystem namespace. It costs nothing when the namespaces coincide and keeps the seam contract honest for extraction.

### D12 — Repo/spec merge mechanics

`music-importer` history is merged into this repo with jj (unrelated-histories merge preserving both lineages). Importer capabilities are adopted into `openspec/specs/`; collisions (`outbound-events`, `public-api`) take an `importer-` prefix; every adopted spec's overview states its module of origin. Version epoch: 3.0.0.

## Risks / Trade-offs

- [Phantom coverage branches in compiled `.svelte` under the 100% gate] → Task-ordered spike: one real component through the full three-project config *before* any UI feature work; escape hatches (`excludeAfterRemap`, documented `v8 ignore` pragmas) if stragglers appear. If the spike fails badly, fallback is istanbul provider before any carve-out of components wholesale.
- [Single failure domain: an importer crash now takes the downloader down] → Accepted at homelab scale; subscriptions restart from checkpoints, deciders converge on redelivery — crash recovery is the designed-for path, not an exception.
- [Facade surface creep: interfaces importing module internals, eroding extraction] → Lint rule (facade-only imports) fails the build; wire-shaped DTO rule enforced by zod schemas at the facade boundary.
- [Event loop stalls from synchronous better-sqlite3 during subscription drains] → Modest batch sizes (~100), yield between batches; drain metrics logged.
- [Losing MCP means losing today's only driving interface until the UI ships] → Task ordering keeps MCP alive until the web UI reaches parity within the same change; the cutover deploy ships them atomically.
- [Coverage gate slower: one CI run covers ~12k+ lines plus browser tests] → Vitest projects parallelize; Playwright container image for the e2e job; accepted cost of one pipeline.
- [jj unrelated-history merge surprises (colocated workspaces, branch protection)] → Do the merge in a colocated workspace; verify `pnpm check` green before any restructure commits.

## Migration Plan

1. **Merge histories** (importer → this repo, no restructure yet) — both trees build independently in-place.
2. **Workspace restructure** — pnpm workspace, packages moved, one gate (`pnpm check`) green across all packages.
3. **Seam swap** — subscription infrastructure lands; webhook publishers/receivers/HMAC/dedupe deleted; in-repo cross-package contract tests replace `contract-drift.yml`.
4. **Facades + UI** — facade extraction, lint rules, coverage spike, then the parity UI; MCP removed as the last step once parity is demonstrated e2e.
5. **Cutover** — one image built; `jgchk/homelab` collapses two stacks to one (volumes for both SQLite files retained; webhook/peer env removed); deploy; verify full loop into Plex; archive `music-importer` repo.
   **Rollback:** the two v2.x images and stack definitions remain in GHCR/homelab history; redeploying them restores the two-service topology (event stores are carried, not migrated — both shapes read the same files).

## Open Questions

- None blocking. The phantom-branch spike (D10) is scheduled work with a decided fallback, not an open decision.
