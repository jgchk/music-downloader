## Why

There is no self-hosted tool that takes a musical intent ("this album/single/track at this quality"), autonomously finds the best-matching, highest-quality version across extensible sources, downloads it, *validates that the bytes are actually playable and actually the thing you asked for*, and automatically retries the next-best version when they aren't — all exposed over multiple machine interfaces. The *arr apps do this for their ecosystems but not for Soulseek, not with post-download audio validation, and not with a pluggable metadata/matching core. This change bootstraps that system as an MVP.

## What Changes

Greenfield build of the MVP. Nothing exists yet, so there are no breaking changes.

- Introduce an **event-sourced acquisition engine** (single `Acquisition` aggregate, functional decide/evolve/react) that orchestrates the lifecycle: resolve metadata → search → rank → download → validate → import, with a **sequential retry loop** that walks ranked candidates and re-searches on exhaustion, bounded by policy.
- Introduce **four per-acquisition policies** as the configuration surface: `QualityPolicy` (ordered buckets + floor), `MatchPolicy` (confidence threshold), `RetryPolicy` (loop bounds), `DownloadPolicy` (transfer timeouts).
- Integrate the first adapters behind stable ports: **slskd** (search + download), **MusicBrainz** (metadata), **ffmpeg** (audio probe / validation), **SQLite** (event store + projections), **filesystem** (library).
- Expose the system over two thin, versioned interfaces: **HTTP API v1** (Fastify) and **MCP** (tools + resources), both over the same use-cases, async submit-and-observe.
- MVP validation = full-decode playability + structural identity (track count + durations vs MusicBrainz). Fingerprinting, transcode detection, retagging, upgrade-until-cutoff, SSE streaming, and additional adapters/interfaces are **seams designed but not built**.
- Adopt **structured logging** (pino) with per-acquisition correlation, secret redaction, and stdout-as-event-stream, kept out of the pure domain — logs complement (never duplicate) the domain event log.

## Capabilities

### New Capabilities
- `acquisition-lifecycle`: the core event-sourced state machine — submit an intent, walk candidates sequentially, retry/re-search on failure bounded by `RetryPolicy`, reach `Fulfilled` or `Exhausted`; crash-safe (checkpointed, idempotent) processing.
- `metadata-resolution`: resolve a request (MusicBrainz id or structured descriptor) to a canonical `Target`; handle ambiguous/empty results.
- `candidate-search-and-ranking`: search sources for candidates, score match confidence against the `Target`, score quality against `QualityPolicy` (buckets + floor), and produce a lexicographic ranking; freshness via re-search on exhaustion.
- `download-management`: download a selected candidate at candidate granularity, surface progress as an ephemeral read-model, and translate P2P reality (stalls, offline peers, hopeless queues) into terminal outcomes with source-agnostic reasons and configurable timeouts.
- `download-validation`: run a composable validator pipeline over downloaded audio producing a single confidence verdict; pass iff confidence meets `MatchPolicy`; MVP validators = playability + structural identity.
- `library-import`: on validation pass, move validated files from staging into an organized library location; never clobber existing releases; report conflicts.
- `public-api`: versioned HTTP (v1) and MCP surfaces over shared use-cases — async submission, status/progress observation, and cancellation — with additive-only, no-breaking-change guarantees enforced by contract tests.

### Modified Capabilities
- None (greenfield).

## Impact

- **New codebase**, single package with lint-enforced layer boundaries: `domain / application / adapters / interfaces / composition`.
- **Stack**: Node + TypeScript (strict) + pnpm + neverthrow + zod + Fastify + pino + vitest + SQLite (`better-sqlite3`) + ffmpeg.
- **External runtime dependencies**: a reachable slskd instance, the MusicBrainz API, and an ffmpeg binary (baked into the container image).
- **Tooling / process**: typescript-eslint (incl. import-boundary rules) + prettier; jujutsu locally over a git remote; GitHub Actions CI (format/lint/typecheck/build/test at 100% coverage + OpenAPI contract test) and CD (GHCR image + conventional-commits automated release); trunk-based development with short-lived PRs.
- **12-factor**: all config (ports, paths, slskd/MusicBrainz endpoints, policy defaults) via environment.
