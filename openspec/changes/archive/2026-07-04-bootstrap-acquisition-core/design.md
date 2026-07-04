## Context

An extensible, *arr-like music downloader. A user submits an intent — "acquire this album/mixtape/single/track at this quality" — and the system autonomously searches, downloads, validates, and (on failure) retries against the next-best candidate until it obtains a valid download or exhausts its options.

The system is long-running and workflow-shaped, not request/response: an intent runs for seconds-to-hours against flaky P2P sources. It is built with Node + TypeScript + pnpm, neverthrow for errors, layered architecture with a DDD domain, event-sourced and event-driven, strict test-first TDD with BDD given/when/then specs.

Extensibility seams (ports & adapters):
- **SearchPort** and **DownloadPort** — first adapter: slskd (Soulseek). Note slskd fulfils *both* ports; the ports stay separate even though one adapter implements both.
- **MetadataPort** — first adapter: MusicBrainz.
- **Inbound interfaces** — HTTP API (versioned) and MCP first; CLI/web later.

This document captures the decisions resolved so far. Threads still open (validation depth, candidate freshness, event-store choice, repo topology, how much P2P reality surfaces) are listed under Open Questions and will be folded in as they resolve.

## Goals / Non-Goals

**Goals:**
- A single, coherent domain core for the acquisition lifecycle that is pure and exhaustively unit-testable.
- A modeling approach where the valuable logic (matching, ranking, retry loop) lives in pure functions, and flaky external I/O is isolated and thin.
- Event streams that read as a clean business narrative, not a telemetry firehose.
- A test format that reads as a product specification (given past events → when command → then events).

**Non-Goals (for this change):**
- Parallel candidate attempts (system is strictly sequential — see Decisions).
- Choosing the concrete event-store technology, validation depth, or repo/package topology (open threads).
- Multiple concurrent adapters per port (design allows it; not built yet).

## Decisions

### D1 — Single `Acquisition` aggregate; downloads and validations are internal steps

The `Acquisition` is the sole aggregate root and the event-sourced consistency/stream boundary. `Download` and `Validation` are steps *inside* it, not independent aggregates.

Rationale:
- All real business invariants live on the acquisition side (at-most-one in-flight download, no retrying a rejected candidate, no fulfilment without a passing validation, terminal Fulfilled/Exhausted). A download has no life outside its acquisition.
- Candidate attempts are **strictly sequential** ("loop until valid / next best version"), so the "one in-flight" invariant is enforced trivially inside one aggregate with no cross-aggregate saga.

**Transfer progress is deliberately kept OFF the event stream.** High-frequency slskd progress ticks (47%… 48%… queue position) are an ephemeral **read model** fed directly by the adapter and surfaced via the status API. Only business-meaningful transitions become events: `DownloadStarted`, `DownloadCompleted`, `DownloadFailed(reason)`. A stall/timeout is a terminal business fact (`DownloadFailed(reason: Stalled)`) even though its *detection* (watching ticks, running the timer) is adapter/application work.

What would flip D1: wanting parallel attempts (top-N simultaneously, keep first to validate) or downloads that are reusable/queryable outside an acquisition. Neither is in scope.

### D2 — Decide / Evolve / React (functional Decider + Process)

Model the core as a Decider (Chassaing) plus its companion Process/reaction:

```
decide : (command, state) -> Result<Event[], DomainError>   // the brain. pure.
evolve : (state, event)   -> state                          // fold. pure, total.
react  : (event, state)   -> Effect[]                       // reflex. pure, trivial.
initialState, isTerminal                                    // Fulfilled/Exhausted = terminal
```

Disciplines:
- **All intelligence lives in `decide`; `react` stays dumb.** The "pick next candidate or exhaust" decision is a `decide` concern (it holds the ranked candidate list in state). `react` only maps an event to a reflexive effect (e.g. `CandidateSelected -> Download(candidate)`).
- **`react` performs no I/O and emits no domain commands.** It returns pure `Effect` *descriptions*. An imperative shell interprets each Effect by calling a port, awaits the async result, and translates the result into a *command* that re-enters `decide`.
- **Effect-results re-enter through `decide`, which acts as the guard.** A late download result for an already-terminal/cancelled acquisition is rejected by `decide`. Idempotency and stale-arrival handling come for free.
- **Ranking lives inside `decide`** (pure, deterministic given candidates + QualityPolicy + Target), emitted as `CandidatesRanked` + `CandidateSelected(best)`.
- **`react` may read `(event, state)`** but only as a projection to shape effects (e.g. passing the Target into `Validate`), never to make a decision.

The cycle:

```
  Command -> decide -> Events -> persist -> evolve -> new state
                                     |
                                     v
                                   react -> Effect[]   (pure descriptions)
                                     |
        (imperative shell) runEffect -> call Port -> raw result
                                     |
                          anti-corruption maps result to Command -> decide -> ...
```

Event → react → Effect → Command trace (each Effect ≈ one outbound port):

| Event | react Effect | Port | Result → Command |
|---|---|---|---|
| `AcquisitionRequested` | ResolveMetadata | MetadataPort | `RecordTarget` / `RecordMetadataFailed` |
| `TargetResolved` | Search | SearchPort | `RecordSearchResults` / `RecordNoResults` |
| `CandidatesRanked` (in decide) | — | — | — |
| `CandidateSelected` | Download | DownloadPort | `RecordDownloadCompleted` / `RecordDownloadFailed` |
| `DownloadCompleted` | Validate | ValidationService | `RecordValidationPassed` / `RecordValidationFailed` |
| `ValidationPassed` | Import | LibraryPort | `RecordImported` |
| `DownloadFailed` / `ValidationFailed` | — (incoming commands) | — | decide picks next or exhausts |
| `AcquisitionFulfilled` / `AcquisitionExhausted` | — (isTerminal) | — | — |

### D3 — Failure taxonomy (business sadness vs infra faults)

- **Expected/business failures are domain events**, not errors: download stalled, no candidates, validation mismatch. They are the happy path of the retry loop and flow through `decide` as `...Failed` events. `decide` returns `Ok(events)`.
- **Unexpected/infrastructure failures are neverthrow `Err`** in the shell: slskd unreachable, event-store write failed, ffprobe missing. They never become domain events; the shell handles them as retryable infra concerns (`ResultAsync`, backoff, dead-letter).
- `DomainError` (the `Err` channel of `decide`) is reserved for *illegal commands* (protocol violations), e.g. `RecordDownloadCompleted` when nothing is downloading.

### D4 — Test shape follows the Decider

The native decider test is given-past-events → when-command → then-events, e.g.:

```
GIVEN [ AcquisitionRequested(album X, FLAC-preferred), TargetResolved(mbid),
        CandidatesRanked([a,b,c]), CandidateSelected(a) ]
WHEN  RecordDownloadFailed(a, reason: PeerOffline)
THEN  [ DownloadFailed(a, PeerOffline), CandidateRejected(a), CandidateSelected(b) ]
```

`decide`/`react`/`evolve` are total pure functions → the large base of the pyramid is mock-free unit tests that read as specs. Only the thin shell interpreter needs fakes (a smaller integration tier). E2E over the wired HTTP/MCP interface is the smallest tier.

### D5 — Validation: composable verdict, cheap MVP floor, pluggable depth

Validation runs a **pipeline of validators**, each contributing to a single combined `ValidationVerdict { confidence, reasons[] }`. The domain (`decide`) consumes the verdict and compares its confidence to a threshold; it never hardcodes which checks ran. New validators can be added — and their scores combined — without touching the aggregate.

Validation must be *strictly stronger* than search-time matching, or the retry loop is pointless. Search-time ranking already uses folder/file names, sizes, and advertised bitrate (all unreliable on Soulseek); therefore validation must inspect the **actual audio bytes** and adds no value by re-checking tags/filenames.

Three axes of validation (only the first two are in the MVP):
1. **Playability** — full decode (decode-to-null), not just header parse; catches truncated/corrupt P2P downloads. *(MVP)*
2. **Identity** — (a) structural: track count + per-track duration vs MusicBrainz within tolerance *(MVP)*; (b) acoustic: Chromaprint/fpcalc → AcoustID → MB recording id *(seam only; later)*.
3. **Quality authenticity** — spectral transcode/upscale detection (fake lossless from lossy) *(seam only; later)*.

`AudioProbePort` abstracts audio inspection; ffmpeg is the first adapter, returning `{ codec, durationMs, decodedCleanly, sampleRate, bitDepth, bitrate, channels }`. Validators depend on the port, stay pure, and are unit-tested with a fake probe. A **single decode pass yields both playability and ground-truth duration** (more accurate than header-estimated duration), so the playability and duration validators share one probe. Reason about the **probed codec, not the file extension** (`.ogg` may be Vorbis/Opus/FLAC); these same probe fields feed `QualityPolicy` ranking later. ffmpeg supports every realistic music format (FLAC/MP3/Opus/Ogg Vorbis/AAC/ALAC/WAV/AIFF/WavPack/APE/…) and is a declared OS-level dependency (bundled in the container image).

`ValidationFailed` reasons:
```
  Unplayable          — decode failed / truncated / corrupt
  WrongTrackCount     — structural: too few / too many tracks
  DurationMismatch    — track durations don't line up with MB within tolerance
  RecordingMismatch   — (fingerprint tier, later) audio is a different recording
  QualityNotAuthentic — (transcode tier, later) claimed lossless is really lossy
```

Confidence is governed by a per-acquisition **`MatchPolicy`** (strict/lenient presets), first-class alongside `QualityPolicy` — not a global constant. `decide` passes iff `verdict.confidence >= MatchPolicy.threshold`.

### D6 — Candidate freshness: hybrid walk + re-search on exhaustion

Soulseek candidates decay in real time (peers log off, queues become hopeless, better sources appear after the search). Strategy:

- **Walk the stored ranked list.** `decide` picks the next-best from the working set on each failure.
- **Optimistic attempt + timeout *is* the availability check** — no separate liveness probe. A dead peer fails fast; a hopeless queue trips a timeout; both collapse to `DownloadFailed(reason)` → next. Staleness within the list is self-healing at low cost.
- **Re-search only on exhaustion.** When the working set empties, `decide` emits `SearchRequested` (a fresh round) rather than jumping to `AcquisitionExhausted` — that's exactly when a newly-online peer could rescue the acquisition. New results are merged with untried candidates, minus the rejected-set, then re-ranked.
- **Bounded by `RetryPolicy`** (termination guarantee): `maxSearchRounds` (default 3), `maxTotalAttempts` (default 15), optional `timeBudget` (off by default). Third per-acquisition policy alongside `QualityPolicy` and `MatchPolicy`.

`AcquisitionExhausted` fires when the working set is empty **and** (a fresh round produced no new candidates **or** the `RetryPolicy` budget is spent).

Event-sourcing stays clean: each search's results are recorded as a `SearchCompleted` **fact**; replay folds recorded results and never re-calls slskd, so the aggregate stays deterministic though the network isn't. Requires a stable **`CandidateIdentity`** — `(username, file path, size)` (or a content hash if slskd exposes one) — for cross-round dedup and the rejected-set.

### D7 — Event store & projections: SQLite behind `EventStorePort`

For a self-hosted, single-user tool, SQLite is the pragmatic, 12-factor-friendly choice (one file, zero-ops, backup = copy the file, single-writer = no concurrency anomalies). Postgres is deferred (its LISTEN/NOTIFY, concurrency, and scale aren't needed for one user, and it adds server ops).

The decisive point is that everything sits behind **`EventStorePort`** (append / read-stream / read-all / subscribe), so swapping to Postgres later touches one adapter only. MVP ships SQLite.

- Single DB: an `events` table plus projection (read-model) tables, rebuilt by replay.
- `events(global_seq PK AUTOINCREMENT, stream_id, version, type, data, metadata)`, `UNIQUE(stream_id, version)` for optimistic concurrency; `global_seq` gives a total order that drives projections and the reactor. WAL mode for concurrent reads.
- Subscriptions: an **in-process `EventBus`** published after commit, with **`global_seq` polling** as the durable catch-up path (recovers projections/reactor after restart). No external pub/sub needed in a single process.
- Read models: acquisition status, **download progress (the ephemeral telemetry from D1)**, library view — all projections, resettable/rebuildable from the log.

### D8 — Event versioning (upcasting) + durable reactor

**Event versioning / upcasting** — the ES form of the no-breaking-change policy. Events persist forever; every event type carries a **version**, and read-side **upcasters** transform `v1 → v2 → …` before `evolve` sees them. Build the seam from day one (version field + a pass-through upcaster registry); write real upcasters only when the first schema change lands. Cheap now, painful to retrofit.

**Durable reactor** — the process manager fires real effects (downloads), so it must survive crashes without double-firing:
- **Checkpoint**: last `global_seq` reacted to, stored durably, resumed on restart (at-least-once delivery).
- **Idempotent dispatch**: guarded by aggregate state (a candidate already `Downloading` is not re-dispatched) plus an idempotency key per `(acquisition, candidate, effectType)`, since slskd is not assumed to dedupe repeat requests.
- Complements D2: effect *results* re-enter via `decide` (which rejects stale/duplicate outcomes); this is the *dispatch* side of the same guarantee.

MVP builds the correctness-critical minimum (checkpoint + state-based idempotent dispatch); the upcasting registry is stubbed pass-through until needed.

### D9 — Repo topology: single package with lint-enforced layer walls

One `package.json` / `tsconfig`, layers as folders, dependency rule enforced by ESLint (`import/no-restricted-paths`) which fails CI — a de facto hard wall given every commit must pass lint. Extensibility comes from the **port interfaces**, not package boundaries, so a workspace adds walls but not capability. Chosen for least ceremony on a solo single-app MVP; extraction to a pnpm workspace later is mechanical if imports stay disciplined and path aliases pre-image package names.

```
  src/
    domain/        decider, policies (Quality/Match/Retry), matching, verdict   (pure, 0 deps)
    application/   use-cases, ports, reactor, effect interpreter
    adapters/      slskd/  musicbrainz/  ffmpeg/  sqlite/  filesystem/
    interfaces/    http/  mcp/
    composition/   DI wiring (vanilla), entry points
```

Dependency rule: `domain <- application <- {adapters, interfaces} <- composition`. Domain imports nothing outward; adapters/interfaces depend only on application ports; composition wires concretes.

### D10 — P2P reality boundary: rich state adapter-internal, terminal facts domain-facing

Restates D1's principle at the `DownloadPort`: slskd's rich transfer reality (queue position, transfer state machine, protocol errors, bytes/sec) is **adapter-internal and feeds only the progress read model**; the domain sees candidate-level **terminal facts** plus a small source-agnostic reason. The aggregate does not model `Queued` vs `Transferring` — only "a download is in-flight for candidate X" (enough for the one-in-flight invariant and D8 idempotent dispatch).

- **`DownloadFailed(candidate, reason)`** carries a small source-agnostic enum, translated by the adapter from Soulseek specifics: `PeerUnavailable · Stalled · QueueTimeout · TransferError · FileUnavailable · Cancelled`. The reason is domain-facing because the status API shows it and policy may differ by reason (e.g. retry a `Stalled` once before rejecting).
- **Timeout detection is adapter/application; thresholds are policy.** Detection (timers, watching ticks) is adapter work; thresholds are a new **`DownloadPolicy { stallTimeout, maxQueueWait }`** passed domain → effect params → adapter, so the adapter stays policy-ignorant. This is the fourth per-acquisition policy alongside `QualityPolicy`, `MatchPolicy`, `RetryPolicy`.
- **`DownloadPort` operates at candidate granularity.** A candidate is usually a folder (whole release, many files); the adapter aggregates per-file transfers into one candidate-level `Completed(files)` / `Failed(reason)`. Partial transfers are an adapter-internal concern (cleanup or resume); the domain sees one outcome.

### D11 — Search-time matching, quality scoring, and ranking

Search-time matching is a fuzzy guess that orders the walk; validation (D5) is the authoritative confirmation, so scoring here is allowed to be probabilistic. Pipeline: adapter groups raw slskd hits into **source-agnostic `Candidate`s**; the domain **scores and ranks** them purely.

- **Seam:** `SearchPort` returns already-grouped `Candidate`s (grouping is source-specific — Soulseek folders; a torrent source would pre-group). Candidate granularity follows target type: album/EP/mixtape → a folder (fileset), single track → one file. Shape: `Candidate { identity(user,path,size), files[{name,codec?,bitrate?,sampleRate?,bitDepth?,durationMs?}], source{speed,freeSlots,queueLength} }`.
- **Matching** = extensible weighted signal-scorer pipeline (like validators) → `matchConfidence ∈ [0,1]` against the normalized `Target` (not MB-specific fields, so a second metadata source drops in): trackCount (high) + duration alignment (high) + name/title similarity (med) + year (low). Weight *structure* over *strings* (names are gameable; track count + durations are the cheap preview of validation).
- **QualityPolicy** = ordered quality **buckets** + a hard **floor** (not a continuous scalar; avoids hi-res out-ranking 16/44 when unwanted). `{ order: [FLAC-24, FLAC-16, ALAC, MP3-320, MP3-V0, Opus-128, …], floor }`. Below floor is **excluded, not penalized**. Advertised format taken at face value at search time (fakes are validation axis 3).
- **Ranking is lexicographic** — match is a gate, quality is the optimization ("highest quality that *matches*"; a pristine wrong-album FLAC must never win):
  1. GATE: keep iff `matchConfidence ≥ MatchPolicy.threshold` AND `quality ≥ QualityPolicy.floor`
  2. quality bucket (per `QualityPolicy.order`) DESC — primary
  3. `matchConfidence` DESC
  4. source reliability (speed, freeSlots, −queueLength) DESC — likeliest to deliver, reduces loop churn
- Deterministic, explainable, pure; lives in `decide` → emitted as `CandidatesRanked`.

### D12 — Interfaces: use-cases as the stable core; thin HTTP + MCP adapters

The system is a workflow (submit → observe), not request/response. Application **use-cases are the real, stable API**; HTTP and MCP are thin inbound adapters that map + validate only, never touching domain types.

- **Use-cases** — Commands: `SubmitAcquisition`, `CancelAcquisition` (`RetryAcquisition` later). Queries: `GetAcquisition`, `ListAcquisitions`, `GetAcquisitionProgress`, `Subscribe` (later).
- **Async shape:** `POST /api/v1/acquisitions {request, qualityPolicy?, matchPolicy?, retryPolicy?, downloadPolicy?}` → `202 {acquisitionId, statusUrl}`; poll `GET /api/v1/acquisitions/{id}` (+ `/progress`) for MVP; `GET …/events` SSE live stream is a post-MVP seam. `POST …/{id}/cancel` → 202.
- **`request`** accepts a MusicBrainz id (`{mbid,type}`) or a structured descriptor (`{type, artist, title, album?}`); resolution runs in the `ResolveMetadata` effect; ambiguity/empty → `MetadataResolutionFailed` surfaced as terminal status. Interactive disambiguation deferred (MVP auto-picks best MB match or fails cleanly).
- **MCP** mirrors the same use-cases idiomatically: Commands → **tools** (`submit_acquisition`, `cancel_acquisition`); Queries → **resources** (`md://acquisitions`, `md://acquisitions/{id}`, `…/progress`).
- **Versioning / no-breaking-change:** HTTP URI versioning (`/api/v1`), additive-only within a version; breaking → `/api/v2`, v1 kept. MCP additive tools/resources; never mutate an existing tool schema. **Versioned DTOs strictly separate from domain models** (inbound anti-corruption): interface adapters map read-models → v1 DTOs so the domain can evolve without breaking the wire.

**Tech choices:**
- **Server: Fastify** — a library called from the composition root (not a DI framework; NestJS is explicitly ruled out by the vanilla-DI constraint). Chosen for daemon maturity: lifecycle hooks, graceful shutdown (don't kill in-flight downloads on deploy), encapsulated plugins. Hono + `@hono/zod-openapi` is the noted alternative. The HTTP layer is a thin `interfaces/http` adapter; never a DI container.
- **Schemas: zod** (zod 4). **Single source of truth** in `interfaces/contracts` drives: (a) Fastify runtime validation via `fastify-type-provider-zod`, (b) OpenAPI 3.1 doc via `@fastify/swagger`/`swagger-ui` at `/docs`, (c) **MCP tool JSON Schemas** via zod 4 native `z.toJSONSchema()` (OpenAPI 3.1 ⊃ JSON Schema; MCP tool inputs are JSON Schema), (d) **breaking-change contract test** — OpenAPI JSON snapshot for MVP (catches all drift), `oasdiff` classification (breaking-only CI failure) as the follow-on.

### D13 — Library & import

The `Import` effect fires on `ValidationPassed` via `LibraryPort`; `Imported` records the final library location, then `AcquisitionFulfilled`.

- **Staging → library separation:** downloads land in a staging/incoming dir (adapter-managed, per-candidate); files reach the library **only** on validation pass; failed download/validation attempts are cleaned from staging (library only ever holds valid music). All paths from config/env (12-factor).
- **Policy/mechanism split:** `LibraryPolicy` naming template (e.g. `{AlbumArtist}/{Album} ({Year})/{Track} - {Title}.{ext}`; one default for MVP, user-configurable later); path rendering is a **pure** application function (`LibraryPolicy` + canonical `Target` → paths, unit-testable); filesystem ops live in the adapter.
- **Move default + copy fallback** across filesystems (cross-device move = copy+delete); hardlink deferred.
- **Import is an extensible strategy behind `LibraryPort`.** MVP strategy = organize + move only (leaves clean, organized files that an external tool can pick up — the user runs **beets separately** for tagging in the near term). Deferred future strategies/decorators, seam preserved: **retagging** with canonical MB metadata + embedded cover art + MB IDs (Picard-style; mutates files, adds a tag-writing dep), and an optional **beets handoff** integration.
- **Conflict handling:** MVP is **fail-safe — never clobber; report the conflict** as terminal status. Deferred but designed-for: **upgrade-until-cutoff** (future `QualityPolicy` cutoff + compare existing library quality vs new candidate before replacing).

### D14 — CI/CD, trunk-based development, jj

- **Enforcement: PR-tip gating + jj history rewriting.** jj has no git-style pre-commit hooks, so quality isn't gated at commit *creation* — instead a fast local `pnpm check` (format + lint + typecheck + build + test) runs in watch mode during dev, and commits are curated green via cheap jj squash/rebase before landing. CI is the hard wall. (Literal per-commit CI verification via `rebase --exec`/matrix is available if the "no commit fails" clause must be mechanical rather than trusted; not MVP.)
- **CI (GitHub Actions / GitHub Runners), on PR + push to main:** setup (pnpm install cached, Node pinned via `.nvmrc`/`packageManager`); parallel quality (prettier `--check`, eslint incl. D9 boundary rules, `tsc --noEmit`, build, D12 contract test); **test pyramid** — unit (pure domain/decider, huge, no I/O) » integration (adapters vs fakes/testcontainers) » e2e (wired app over real HTTP+MCP vs **fake** externals). **Coverage thresholds = 100%** (vitest) → CI red on any bare line.
- **Never hit real MusicBrainz/Soulseek in CI** (rate limits, non-determinism): slskd container or `SearchPort`/`DownloadPort` fake + recorded MB fixtures / stub metadata server.
- **CD (12-factor):** container image with ffmpeg baked in (D5), config via env; build + push to **GHCR** on merge to main, versioned image on release tags. **Conventional commits → automated version bump + changelog + GitHub Release** (semantic-release/Changesets) — operationalizes the semver/no-breaking-change policy.
- **Trunk-based:** main always releasable, **short-lived PRs into main**, feature flags for incomplete work, CI a required check before merge.

### D15 — Logging & observability

- **Structured, leveled logging** via **pino** (Fastify's native logger), JSON output. Log level from env (12-factor).
- **Logs are event streams to stdout** (12-factor factor XI): the app never manages log files or routing; the runtime/environment aggregates. Distinct from domain events — see below.
- **Correlation:** every log line carries the `acquisitionId` (and a request id at the HTTP edge) so one acquisition's journey across resolve → search → download → validate → import is traceable.
- **Redaction:** credentials (slskd auth, tokens) and file contents are never logged; sensitive fields are redacted by pino redaction config.
- **Level discipline:** `error` = faults needing attention (infra `Err` from D3); `warn` = recoverable/business-sad (e.g. candidate rejected); `info` = lifecycle milestones; `debug` = adapter I/O detail.
- **Purity boundary (critical):** the pure domain — `decide`/`evolve`/`react`, scorers, validators — performs **no logging**; it stays a pure function. Logging lives only in the imperative shell, adapters, and interfaces. Preserves the functional core and its mock-free testability.
- **Two distinct streams, not one:** *domain events* (event store — business truth, replayable, the source of state) vs *operational logs* (diagnostics — ephemeral, ops-facing). Logs complement events; they never substitute for them or duplicate the event log.

### Design principles — SOLID & OOP patterns (where they live)

Recorded so these are intentional, not incidental:
- **DIP** — application depends on ports (interfaces); adapters depend inward (D9). **OCP** — new sources/validators/scorers/import strategies added without modifying existing code (ports + strategy pipelines). **SRP** — layer + capability boundaries. **ISP** — narrow, per-concern ports (`SearchPort` ≠ `DownloadPort` even when one adapter implements both, D1). **LSP** — every adapter is substitutable behind its port (enforced by shared contract tests).
- **Patterns:** Ports & Adapters / Hexagonal (whole architecture); Decider (D2); Strategy (match scorers, validators, import strategy); Process Manager / Reactor (D2/D8); Anti-Corruption Layer (metadata `Target` normalization, inbound DTO mapping); Repository/Event Store (D7); Projection/read-model (D7).

## Risks / Trade-offs

- **Aggregate holds the candidate list.** A search may return many candidates; the `CandidatesRanked` event can be sizeable. Acceptable for a self-hosted single-user tool; revisit if event size becomes a problem.
- **Candidate staleness.** Ranking once and walking a stored list risks peers going offline between selection and download. Whether we re-search vs walk a stale list is an open thread (#3) and interacts with D2's react/decide split.
- **Progress-as-read-model** means progress is not replayable from the event log. Intentional; progress is ephemeral telemetry, not a business fact.
- **Single-decider composition.** We start with one Decider. If a `Library/Import` concern grows, decider composition (Chassaing) is available without disturbing the pattern.

## Resolved threads

All exploration threads resolved:

- ~~**#1 Aggregate boundaries**~~ — D1 (+ D2)
- ~~**#2 Validation depth**~~ — D5
- ~~**#3 Candidate freshness**~~ — D6
- ~~**#4 Event store & projections**~~ — D7/D8
- ~~**#5 Repo topology**~~ — D9
- ~~**#6 P2P reality leakage**~~ — D10
- ~~**#7 Matching / quality / ranking**~~ — D11
- ~~**#8 Versioned HTTP/MCP surface**~~ — D12
- ~~**#9 Library & import**~~ — D13
- ~~**#10 CI/CD, trunk-based, jj**~~ — D14

**Deferred post-MVP (seams designed, not built):** acoustic fingerprinting (D5 axis 2b) · transcode/upgrade detection (D5 axis 3) · SSE live event stream (D12) · interactive MB disambiguation (D12) · retagging + cover art + beets handoff (D13) · upgrade-until-cutoff (D13) · additional search/download/metadata adapters and CLI/web interfaces (ports ready) · Postgres event-store adapter (D7).
