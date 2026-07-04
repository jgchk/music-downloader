<!-- Every implementation task follows strict red-green-refactor: write the failing test(s) first, then the minimum code to pass, then refactor. Coverage stays at 100%. Domain/application tests are BDD given/when/then per capability spec; adapters use integration tests against fakes/containers; the wired app is covered by a small E2E tier. -->

## 1. Project scaffolding & tooling

- [x] 1.1 Initialize repo: pnpm, TypeScript (strict), `packageManager` + `.nvmrc` pinned Node; colocate jujutsu over a git remote
- [x] 1.2 Configure vitest with coverage thresholds set to 100% (lines/branches/functions/statements)
- [x] 1.3 Configure prettier and typescript-eslint; add `import/no-restricted-paths` boundary rules enforcing domain ← application ← {adapters, interfaces} ← composition
- [x] 1.4 Add `pnpm check` (format + lint + typecheck + build + test) and confirm it runs clean on an empty skeleton
- [x] 1.5 Create the `src/{domain,application,adapters,interfaces,composition}` layer folders with placeholder barrels
- [x] 1.6 Stand up a minimal GitHub Actions CI (setup + `pnpm check`) so the gate exists from the first commit
- [x] 1.7 Set up pino structured logging foundation (JSON, levels, level + redaction config from env); add a lint boundary asserting the domain layer imports no logger

## 2. Domain value objects & policies (pure, test-first)

- [x] 2.1 `Target` model (normalized artist/title/track list/durations/year) with tests
- [x] 2.2 `Candidate` and `CandidateIdentity` (stable `(user, path, size)` key) with tests
- [x] 2.3 `QualityPolicy` (ordered buckets + floor) and quality-bucket resolution from probe fields
- [x] 2.4 `MatchPolicy` (confidence threshold), `RetryPolicy` (maxSearchRounds/maxTotalAttempts/timeBudget), `DownloadPolicy` (stallTimeout/maxQueueWait), each with defaults

## 3. Domain matching, ranking & validation logic (pure, test-first)

- [x] 3.1 `MatchScorer` pipeline (trackCount, duration, name, title, year signals → confidence ∈ [0,1]) covering the candidate-search-and-ranking scenarios
- [x] 3.2 Ranking function: gate (match threshold + quality floor) → quality bucket → match confidence → source reliability, lexicographic and deterministic
- [x] 3.3 `ValidationVerdict` and the composable validator-combination logic producing one confidence + reasons (download-validation scenarios, verdict-vs-`MatchPolicy`)

## 4. Acquisition decider (pure, test-first — the core)

- [x] 4.1 Define acquisition commands, events, and state; implement `evolve` (fold) with tests
- [x] 4.2 Implement `decide` for resolve/search/rank/select happy path (given-events / when-command / then-events per acquisition-lifecycle spec)
- [x] 4.3 Implement `decide` retry-loop branches: reject-and-next-best, exhaust working set, bounded re-search, `Fulfilled`/`Exhausted`/`Cancelled`, stale-outcome rejection
- [x] 4.4 Implement `react` (event → Effect descriptions) and `isTerminal`; unit-test the event→effect mapping table

## 5. Application layer: ports, use-cases, effect shell, reactor

- [x] 5.1 Declare outbound ports: `SearchPort`, `DownloadPort`, `MetadataPort`, `AudioProbePort`, `LibraryPort`, `EventStorePort` (neverthrow `ResultAsync` signatures)
- [x] 5.2 Implement command/query use-cases (Submit/Cancel; Get/List/Progress) against ports and the decider
- [x] 5.3 Implement the effect interpreter (Effect → port call → result → command) with anti-corruption mapping; tests with fake ports
- [x] 5.4 Implement the durable reactor: checkpoint (last global_seq), at-least-once consumption, state-based idempotent dispatch; test no-duplicate-download-on-restart
- [x] 5.5 Implement read-model projections (acquisition status, download progress, library view) rebuildable from the log
- [x] 5.6 Emit `acquisitionId`-correlated operational logs from the effect shell and reactor at appropriate levels; keep `decide`/`evolve`/`react` log-free

## 6. Event store adapter (SQLite)

- [x] 6.1 Implement `EventStorePort` on SQLite: `events(global_seq, stream_id, version, type, data, metadata)`, `UNIQUE(stream_id, version)` optimistic concurrency, WAL; integration tests
- [x] 6.2 Implement the in-process `EventBus` (publish-after-commit) + `global_seq` polling catch-up
- [x] 6.3 Implement the event versioning/upcasting seam (version field + pass-through upcaster registry)

## 7. Outbound adapters (integration tests vs fakes/containers)

- [x] 7.1 MusicBrainz `MetadataPort` adapter: resolve by id and by structured descriptor → normalized `Target`; ambiguous/empty → failure (recorded fixtures, no live calls in CI)
- [x] 7.2 ffmpeg `AudioProbePort` adapter: decode-to-null playability + exact duration; codec/sample-rate/bit-depth/bitrate from probe; multi-format coverage
- [x] 7.3 slskd `SearchPort` adapter: query from `Target`, group hits into source-agnostic candidates at target granularity, surface reliability signals
- [x] 7.4 slskd `DownloadPort` adapter: candidate-granular download, progress callbacks, stall/queue timeouts, aggregate per-file into one outcome with normalized reasons
- [x] 7.5 filesystem `LibraryPort` adapter: staging→library move + cross-filesystem copy fallback, never-clobber conflict, staging cleanup (import as a strategy seam)
- [x] 7.6 Log adapter I/O at debug with redaction; test that credentials and file contents are never emitted

## 8. Interfaces: contracts, HTTP, MCP

- [x] 8.1 Define zod (v4) request/response schemas in `interfaces/contracts` as the single source of truth
- [x] 8.2 Implement Fastify HTTP API v1 (`/api/v1/acquisitions` submit/get/progress/cancel/list) via `fastify-type-provider-zod`; versioned DTOs mapped from read-models
- [x] 8.3 Generate + serve OpenAPI via `@fastify/swagger`; add the OpenAPI snapshot contract test (breaking-change guard)
- [x] 8.4 Implement the MCP server: submit/cancel tools + acquisition resources, tool schemas via `z.toJSONSchema()`
- [x] 8.5 Integration tests for both interfaces over the same use-cases
- [x] 8.6 Wire Fastify/pino request logging with a request id propagated as the `acquisitionId` correlation at the edge

## 9. Composition root & configuration

- [x] 9.1 Implement vanilla DI wiring in `composition` (construct adapters, inject into use-cases, start reactor + interfaces)
- [x] 9.2 Load all config from environment (12-factor): ports, paths, slskd/MusicBrainz endpoints, policy defaults; fail fast on invalid config
- [x] 9.3 Wire graceful shutdown (drain in-flight work, close store) into the Fastify lifecycle
- [x] 9.4 Author the container image with ffmpeg baked in

## 10. End-to-end & CI/CD finalization

- [x] 10.1 E2E tests: wired app over real HTTP + MCP against fake slskd/MusicBrainz — happy path, retry-then-succeed, exhaustion, conflict
- [x] 10.2 Finalize CI pyramid job: parallel quality + unit/integration/e2e with 100% coverage gate and the contract test
- [x] 10.3 CD: build + push GHCR image on merge; conventional-commits automated version bump, changelog, and GitHub Release
- [x] 10.4 Document run/config (env vars, dependencies) in the README
