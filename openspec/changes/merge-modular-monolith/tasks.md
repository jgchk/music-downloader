# Tasks — merge-modular-monolith

## 1. History merge

- [ ] 1.1 Create a colocated jj workspace for the merge work (branch protection + gh need it)
- [ ] 1.2 Merge music-importer's history into this repo (jj unrelated-histories merge, importer tree landing under a temporary `importer/` prefix, both lineages preserved)
- [ ] 1.3 Verify both trees still build and pass their own gates in-place, unmodified

## 2. Workspace restructure

- [ ] 2.1 Convert the repo to a pnpm workspace: `packages/downloader`, `packages/importer`, root-level shared tooling config (tsconfig/eslint/prettier bases)
- [ ] 2.2 Move each service's `src/` + tests into its package; dedupe devDependencies to the root (they are currently identical)
- [ ] 2.3 Re-point the root `pnpm check` gate to run format → lint → typecheck → build → test w/ coverage across the whole workspace; gate green
- [ ] 2.4 Merge the openspec trees: adopt importer archive dirs with provenance notes; retire the importer repo's config.yaml context into this repo's

## 3. Cross-module delivery seam

- [ ] 3.1 Expose a readable outbound feed (gapless global position) from each module's event store per `cross-module-delivery`
- [ ] 3.2 Implement the catch-up subscription runtime: named resettable checkpoint in the consumer's store, batch drain (~100, yield between batches), checkpoint advancing in the same transaction as consumer effects
- [ ] 3.3 Implement the notify-then-poll loop: post-commit wakeup as lossy hint, seconds-scale fallback poll, always poll on startup; crash-recovery scenario covered by test
- [ ] 3.4 Implement poison-event policy: bounded retries w/ backoff, then per-subscription halt-or-park with dead-letter row in the consumer's file
- [ ] 3.5 Swap importer intake onto the subscription (tolerant reader + ACL + INTAKE_SOURCE_ROOT re-rooting unchanged); delete intake webhook + verification
- [ ] 3.6 Swap verdict flow: importer records `release.verdict` in its own store; downloader consumes via subscription through the existing ACL; delete verdict webhook + `DeliveryDedupe`
- [ ] 3.7 Delete all webhook publisher/dispatcher machinery and webhook config from both modules
- [ ] 3.8 Replace `contract-drift.yml` with in-repo cross-package contract tests against the frozen fixtures; delete the workflow

## 4. Facades and boundary enforcement

- [ ] 4.1 Extract each module's wire-shaped facade (commands/queries over serializable DTOs, zod at boundary, errors as values) as its package's sole export
- [ ] 4.2 Add lint enforcement: interface packages import facades only; no cross-module internal imports; no shared kernel; violation = build break
- [ ] 4.3 Re-point existing HTTP/MCP interfaces at the facades (temporary — they stay alive until web UI parity, tasks 6.x)

## 5. Web UI foundation

- [ ] 5.1 Coverage spike: one real Svelte 5 component through the full three-project vitest config (server/ssr/client-Chromium, merged root coverage, `coverage.include` set, `excludeAfterRemap`) — confirm branch mapping is sane before proceeding; fallback istanbul provider if not
- [ ] 5.2 Scaffold `packages/web`: SvelteKit, adapter-node, the three-project vitest setup with the 100% gate and named carve-outs; Playwright e2e job scaffolded threshold-free
- [ ] 5.3 Implement the composed process entry: composition root boots both module runtimes (stores, subscriptions, reactors, pollers) then mounts the SvelteKit handler; graceful shutdown
- [ ] 5.4 Dev-mode story: Vite dev server with facades wired via SSR; document in README

## 6. Web UI parity features

- [ ] 6.1 Submit acquisition flow (form action → downloader facade; validation errors surfaced per error taxonomy)
- [ ] 6.2 Acquisition progress/list view (facade read models; phase, candidate, failure detail)
- [ ] 6.3 Cancel acquisition flow
- [ ] 6.4 Import review queue + resolution flow (importer facade; resolve semantics unchanged from MCP tool)
- [ ] 6.5 Playwright e2e covering the parity flows against a dev instance
- [ ] 6.6 Remove MCP interfaces + SDK dependency and the Fastify HTTP layer from both modules; delete Fastify dependency; parity demonstrated first
- [ ] 6.7 Consolidate env config (webhook/peer-URL vars gone, single process config); update `.env.example`

## 7. Release and pipeline

- [ ] 7.1 Single product versioning at 3.0.0: root version, `version:prep` updated for the workspace, one changelog
- [ ] 7.2 Pipeline: one workflow runs the whole-workspace gate (browser tests need Playwright/Chromium in CI; e2e job separate and non-gating); one GHCR image built from the composed process
- [ ] 7.3 Dockerfile: multi-stage build for the workspace; ffmpeg + beets bridge runtime deps carried from both images; both SQLite store paths volumed

## 8. Out-of-process E2E

- [ ] 8.1 Rework `test/e2e/run.sh` to the single service: drive intent → download (stubbed slskd) → cross-module handoff → import (real beets) → terminal imported outcome via the web interface endpoints
- [ ] 8.2 E2E asserts both store files advance and the subscription checkpoint survives a mid-flow process restart

## 9. Cutover

- [ ] 9.1 homelab: collapse the two Komodo stacks to one (single image tag, both SQLite volumes retained, webhook/peer env removed); PR to jgchk/homelab
- [ ] 9.2 Deploy to flight; verify the full loop into Plex end-to-end; verify no lingering slskd records
- [ ] 9.3 Remove the stale MCP connector registrations from Claude Code config (both LAN connectors)
- [ ] 9.4 Archive the music-importer GitHub repo (read-only) with a pointer to this repo
