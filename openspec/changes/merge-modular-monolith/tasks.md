# Tasks — merge-modular-monolith

## 1. History merge

- [x] 1.1 Create a colocated jj workspace for the merge work (branch protection + gh need it) — main repo is itself colocated and clean; worked there directly
- [x] 1.2 Merge music-importer's history into this repo (jj unrelated-histories merge, importer tree landing under a temporary `importer/` prefix, both lineages preserved)
- [x] 1.3 Verify both trees still build and pass their own gates in-place, unmodified — both `pnpm check` gates exit 0 (root + importer/)

## 2. Workspace restructure

- [x] 2.1 Convert the repo to a pnpm workspace: `packages/downloader`, `packages/importer`, root-level shared tooling config (tsconfig/eslint/prettier bases)
- [x] 2.2 Move each service's `src/` + tests into its package; dedupe devDependencies to the root (they are currently identical)
- [x] 2.3 Re-point the root `pnpm check` gate to run format → lint → typecheck → build → test w/ coverage across the whole workspace; gate green
- [x] 2.4 Merge the openspec trees: adopt importer archive dirs with provenance notes; retire the importer repo's config.yaml context into this repo's

## 3. Cross-module delivery seam

- [x] 3.1 Expose a readable outbound feed (gapless global position) from each module's event store per `cross-module-delivery`
- [x] 3.2 Implement the catch-up subscription runtime: named resettable checkpoint in the consumer's store, batch drain (~100, yield between batches), checkpoint advancing in the same transaction as consumer effects
- [x] 3.3 Implement the notify-then-poll loop: post-commit wakeup as lossy hint, seconds-scale fallback poll, always poll on startup; crash-recovery scenario covered by test
- [x] 3.4 Implement poison-event policy: bounded retries w/ backoff, then per-subscription halt-or-park with dead-letter row in the consumer's file
- [x] 3.5 Swap importer intake onto the subscription (tolerant reader + ACL + INTAKE_SOURCE_ROOT re-rooting unchanged); delete intake webhook + verification
- [x] 3.6 Swap verdict flow: importer records `release.verdict` in its own store; downloader consumes via subscription through the existing ACL; delete verdict webhook + `DeliveryDedupe`
- [x] 3.7 Delete all webhook publisher/dispatcher machinery and webhook config from both modules
- [x] 3.8 In-repo cross-package seam contract tests against the producers' frozen fixtures (importer reads downloader's acquisition.fulfilled fixture; downloader reads importer's release.verdict fixture) — DEVIATION: `contract-drift.yml` is kept, it polices the EXTERNAL slskd/MusicBrainz contracts (external-api-contracts capability), not the seam; the proposal mislabeled it

## 4. Facades and boundary enforcement

- [x] 4.1 Extract each module's wire-shaped facade (commands/queries over serializable DTOs, zod at boundary, errors as values) as its package's sole export
- [x] 4.2 Add lint enforcement: interface packages import facades only; no cross-module internal imports; no shared kernel; violation = build break
- [x] 4.3 Re-point existing HTTP/MCP interfaces at the facades (temporary — they stay alive until web UI parity, tasks 6.x)

## 5. Web UI foundation

- [x] 5.1 Coverage spike: one real Svelte 5 component through the full three-project vitest config (server/ssr/client-Chromium, merged root coverage, `coverage.include` set, `excludeAfterRemap`) — confirm branch mapping is sane before proceeding; fallback istanbul provider if not
  - VERDICT: 100% honestly achievable on .svelte with v8 (33/33 stmts, 10/10 branches on the spike). Two structural rules learned: (1) SSR+client compile the same source twice and coverage merges position-wise across variants, so every server-renderable state needs an SSR test (make initial UI state prop-drivable) and every interaction a client test; (2) class-attribute interpolation compiles a nullish-guard branch unreachable under typed props — use a static class + data-* attribute (or a pragma). No istanbul fallback needed; no pragmas needed.
- [x] 5.2 Scaffold `packages/web`: SvelteKit, adapter-node, the three-project vitest setup with the 100% gate and named carve-outs; Playwright e2e job scaffolded threshold-free — svelte-check wired into root typecheck, prettier/eslint svelte support at root, adapter-node build in root build, `test:e2e:web` script + smoke spec passing
- [x] 5.3 Implement the composed process entry: composition root boots both module runtimes (stores, subscriptions, reactors, pollers) then mounts the SvelteKit handler; graceful shutdown — realized as module `./runtime` factory entries + `$lib/server` composition seam booted by the SvelteKit `init` hook (lint confines runtime imports to $lib/server); facades on `locals`; shutdown via adapter-node `sveltekit:shutdown`
- [x] 5.4 Dev-mode story: Vite dev server with facades wired via SSR; document in README — dev and prod share the same hooks composition (no mock daemon); `pnpm dev` + packages/web/.env.example; README Running section rewritten (full live-deps dev smoke deferred to the e2e tier, needs slskd+beets)

## 6. Web UI parity features

- [x] 6.1 Submit acquisition flow (form action → downloader facade; validation errors surfaced per error taxonomy) — /acquisitions/new; facade errors mapped by $lib/server/facade-errors
- [x] 6.2 Acquisition progress/list view (facade read models; phase, candidate, failure detail) — /acquisitions + /acquisitions/[id]; additive `target` field added to the status DTO for the spec's target description
- [x] 6.3 Cancel acquisition flow — ?/cancel action on the detail page, shown while non-terminal
- [x] 6.4 Import review queue + resolution flow (importer facade; resolve semantics unchanged from MCP tool) — /reviews + /reviews/[id]; all 9 verbs incl. per-track manual tags; retry verb always offered, NoRetainedCandidate refusal rendered (parity with the MCP tool's behavior)
- [x] 6.5 Playwright e2e covering the parity flows against a dev instance — tests/serve.sh boots the REAL adapter-node build (real beets validation, scratch roots, closed-port third parties, ORIGIN set); 5 specs green
- [x] 6.6 Remove MCP interfaces + SDK dependency and the Fastify HTTP layer from both modules; delete Fastify dependency; parity demonstrated first — interfaces/{http,mcp} + per-module entries/config/version deleted from both; module deps now better-sqlite3/neverthrow/pino/zod only; module e2e suite drives the facade; contracts + seam consumers kept
- [x] 6.7 Consolidate env config (webhook/peer-URL vars gone, single process config); update `.env.example` — one root .env.example (composed surface incl. BRIDGE_SCRIPT for bundled deployments); module-level examples deleted; webhook-era-inert scenario pinned in the composed config test

## 7. Release and pipeline

- [x] 7.1 Single product versioning at 3.0.0: root version, `version:prep` updated for the workspace, one changelog — fixed the last-release anchor (git describe is distance-ambiguous now that importer v0.1.x tags are reachable; scripts/release/tags.ts picks the highest semver among tags `--merged origin/main`, unit-tested); dry-run evidence: `version:prep --check` reports "expected version 3.0.0 but package.json has 2.5.1" (major via the branch's `!` commits). The real bump runs pre-PR after group 8. NOTE: the migration PR's generated 3.0.0 CHANGELOG section will include imported importer-lineage commits (catv's range is set-subtraction); hand-curate that one section at bump time — check mode only requires the section to exist.
- [x] 7.2 Pipeline: one workflow runs the whole-workspace gate (browser tests need Playwright/Chromium in CI; e2e job separate and non-gating); one GHCR image built from the composed process — required-check job names (version-check/quality/test) unchanged, no ruleset edit needed; test job installs Chromium for the browser-mode client project; new non-required `web-e2e` job (Chromium + beets venv w/ BRIDGE_PYTHON); release job unchanged — its `pnpm test:e2e` image gate depends on group 8's rework before anything merges to main.
- [x] 7.3 Dockerfile: multi-stage build for the workspace; ffmpeg + beets bridge runtime deps carried from both images; both SQLite store paths volumed — node:24.18-slim two-stage; prod deps via clean `pnpm install --prod` (prune can't relink workspace importers); beets pinned via bridge requirements.txt in /opt/beets-venv with ENV BRIDGE_PYTHON/BRIDGE_SCRIPT baked; CMD `node packages/web/build`, EXPOSE 3000, env-driven volume paths. Smoke: `docker build .` then run with scratch env (closed-port third parties, minimal beets config) -> 200 on / , /acquisitions, /reviews; log shows beets 2.12.0 validated before the listener; both event-store files created under the mount.

## 8. Out-of-process E2E

- [x] 8.1 Rework `test/e2e/run.sh` to the single service: drive intent → download (stubbed slskd) → cross-module handoff → import (real beets) → terminal imported outcome via the web interface endpoints — host-network docker-run orchestration (compose file retired); beets pinned to the MB stub's ws/2 JSON (no live third party); fixture seeded at the slskd-REPORTED location; full loop green in ~7s. Found+fixed a real config bug: INTAKE_SOURCE_ROOT defaulted to STAGING_ROOT but deliveries are deposits under LIBRARY_ROOT
- [x] 8.2 E2E asserts both store files advance and the subscription checkpoint survives a mid-flow process restart — kill forced between fulfilment and import via a BRIDGE_PYTHON gate wrapper; import completes exactly once after restart. Found+fixed a real product bug: both reactors' one-shot startup drain dropped events appended mid-drain (no fallback poll) → crash-resumed imports stalled; reactors now subscribe-before-drain with coalesced drains + a 5s fallback poll (regression-tested in both packages)

## 9. Cutover

- [x] 9.1 homelab: collapse the two Komodo stacks to one (single image tag, both SQLite volumes retained, webhook/peer env removed) — direct push to jgchk/homelab main per its GitOps convention; importer stack replaced by a tombstone stub (no docker access on flight; Komodo managed=false), MIGRATION-v3.md runbook committed
- [x] 9.2 Deploy to flight — v3.0.0 live on :3000; seam checkpoints seeded at heads (64/18) before deploy, verified held with zero replay; UI lists pre-merge history; old importer stopped (:3001 dark). Full loop into Plex re-proven by the image-gated e2e; first real acquisition is the live confirmation
- [x] 9.3 Remove the stale MCP connector registrations from Claude Code config — both LAN connectors + the local project connector removed
- [x] 9.4 Archive the music-importer GitHub repo (read-only) with a pointer to this repo — archived, description points here
