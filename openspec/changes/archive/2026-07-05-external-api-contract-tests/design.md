## Context

The slskd and MusicBrainz adapters (`src/adapters/slskd/*`, `src/adapters/musicbrainz/*`) talk to external HTTP services through the injectable `HttpClient` seam (`src/adapters/support/http.ts`, a thin wrapper over global `fetch`), with base URLs and credentials from env. Today the "contract" with those services exists implicitly in three unsynchronized places: hand-written TS interfaces the adapters cast into, hand-written WireMock stub mappings in `test/e2e/stubs/`, and the adapters' parsing logic. Nothing checks any of them against the real services — a drift already bit us once (the slskd transfers payload is a user object with `directories[]`, not an array; the stub matched the wrong assumption and tests passed while the app broke).

Neither provider knows this project exists, so provider-verified (Pact-style) contracts are unavailable. The applicable industry pattern is Fowler's integration contract test: the consumer runs contract checks against the live provider on a separate cadence, and the same contract artifact validates the test doubles used in fast builds.

Facts established during exploration:

- slskd serves an OpenAPI 3.0.1 document at `/swagger/v0/swagger.json` when started with `SLSKD_SWAGGER=true`. The maintainer's live instance (v0.22.5.0; latest upstream is 0.25.1) has swagger disabled, but any slskd docker image can serve its own spec locally with no Soulseek credentials.
- MusicBrainz has no machine-readable spec for its JSON format (`fmt=json`); it is prose-documented. The live API is public, anonymous, and rate-limited (1 req/s, meaningful `User-Agent` required).
- slskd behavioral endpoints (search, transfers) require a live Soulseek login and peers, so "run the real thing in CI" is not deterministic for behavior — only its API surface (the spec) is cheaply verifiable.

Constraints: test-first with 100% unit coverage; errors are values; dependencies point inward; config from env; no secrets in source.

## Goals / Non-Goals

**Goals:**

- One codified contract artifact per external service, shared verbatim by every tier that claims to test that service.
- A fast, isolated, wire-level contract tier that runs on every commit with no docker dependency.
- Scheduled detection of provider drift with a notification, decoupled from the commit gate.
- Runtime enforcement so a contract violation in production surfaces at the boundary as a modeled failure.
- E2E WireMock stubs mechanically prevented from drifting from the contract.

**Non-Goals:**

- Provider-side (Pact broker) contract verification — impossible without provider cooperation.
- Behavioral drift detection for slskd (semantics changing under an unchanged shape) — the drift tier checks API surface, not P2P behavior.
- Testing slskd/MusicBrainz themselves — only the slice of their APIs we consume.
- Replacing the E2E tier or the adapter unit tests; both remain.

## Decisions

### D1: Zod schemas are the single source of truth for the contract

One schema module per external service (e.g. `src/adapters/slskd/schemas.ts`, `src/adapters/musicbrainz/schemas.ts`) defining every response shape the adapters consume. Schemas are **non-strict** (zod default: unknown keys stripped/ignored): a provider adding fields is not drift; only a consumed field going missing or changing type is. Existing hand-written interfaces (`MbRelease`, `SlskdTransfer`, …) are replaced by `z.infer` types so the contract and the compile-time types cannot diverge.

*Alternatives considered:* generating types from slskd's OpenAPI spec (rejected: MusicBrainz has no spec, codegen churn covers 70 paths when we consume ~6, and generated types carry no runtime validation); keeping TS casts and writing schemas only for tests (rejected: leaves the production boundary unguarded and creates a fourth unsynchronized contract location).

### D2: Adapters parse through the schemas at runtime

`safeParse` at the point each adapter currently does `JSON.parse` + cast. A schema violation follows the same path as a non-2xx response today: a thrown boundary error that the application layer already maps to a modeled infrastructure failure (`InfraError`), keeping errors-as-values at the port surface. This turns "provider changed a payload" from a silent downstream misbehavior into an immediate, attributable boundary failure.

### D3: Tier 1 runs against a real in-process HTTP server serving recorded fixtures

Each contract test boots a plain `node:http` server on an ephemeral port serving fixture responses, and exercises the real adapter with the real `fetch` client against it. Tests assert both directions of the contract: the requests the adapter sends (method, path, query, `X-API-Key`/`User-Agent`/`Accept` headers, body) and correct consumption of schema-valid responses. No docker, no network, runs in milliseconds.

*Alternatives considered:* WireMock via testcontainers (rejected for tier 1: docker on every commit, ~seconds of startup per suite; WireMock stays in the E2E tier where docker already runs); msw/nock interception (rejected: one more dependency, and interception is not the true wire — a real socket exercises URL construction, headers, and fetch semantics exactly as production does).

### D4: Fixtures are recorded from the real services, sanitized, and carry provenance

Frozen fixtures are captured once from reality, not hand-written — hand-written fixtures are how the transfers-shape bug survived. Recording scripts live in the repo:

- **MusicBrainz**: fully scriptable, anonymous — replay the four consumed request shapes (`/release/{mbid}?inc=recordings+artist-credits&fmt=json`, `/recording/{mbid}?inc=artist-credits&fmt=json`, release search, recording search) against live `musicbrainz.org` using stable well-known MBIDs at ≤1 req/s.
- **slskd**: a one-time recording session against the maintainer's live instance (base URL + API key via `SLSKD_BASE_URL`/`SLSKD_API_KEY` env — never committed), capturing genuine search create/state/responses and transfer enqueue/poll payloads, then sanitized (usernames, IPs, share paths).

Every fixture file carries provenance metadata (source, capture date, service version where known) and is validated against its schema by a tier-1 test, so a fixture can never contradict the contract.

### D5: The consumed slskd API surface is declared explicitly, and drift is checked spec-to-spec

A small manifest in the contract module lists the slskd operations we consume (method + path + the response/request schema fields we rely on): `POST /api/v0/searches`, `GET /api/v0/searches/{id}`, `GET /api/v0/searches/{id}/responses`, `POST|GET /api/v0/transfers/downloads/{username}`, `DELETE /api/v0/transfers/downloads/{username}/{id}`.

In-repo we commit a snapshot of the **pinned** version's `swagger.json` (captured by booting `slskd:0.22.5` with `SLSKD_SWAGGER=true`; the live instance has swagger disabled) alongside a provenance file (version, capture date, image digest). The weekly drift job boots `slskd:latest` the same way, fetches its spec, and asserts every manifest entry still exists with a compatible shape — reporting the pinned→latest delta for the consumed surface. This catches "slskd pushed a breaking change" before the maintainer upgrades the instance.

*Alternative considered:* diffing the full 70-path spec (rejected: noisy; changes outside the consumed surface are not our drift).

### D6: MusicBrainz drift is checked by live replay against the shared schemas

The weekly job reuses the MusicBrainz recording script's request set against live `musicbrainz.org` and validates each response with the same zod schemas tier 1 uses. Schema pass = no drift, regardless of value-level changes (tags, ratings, and other volatile data change constantly; values are not the contract).

### D7: Tiering, gating, and notification

- **Tier 1** lives in `test/contract/` with its own vitest config (mirroring the `test/e2e/` precedent), wired into `pnpm check` and the CI quality gate as a distinct step. Like the E2E tier, it is excluded from the unit coverage gate; the schema modules themselves are `src/` code and get 100% unit coverage as usual.
- **Tier 2** is a separate GitHub Actions workflow: `on: schedule` (weekly cron) + `workflow_dispatch`. It never blocks commits or PRs. On failure it opens — or updates, if already open — a pinned "contract drift" GitHub issue containing the violation details (which manifest entries broke, which schema paths failed). Docker is available on GitHub-hosted runners for the slskd spec fetch.

## Risks / Trade-offs

- [slskd's generated OpenAPI spec may be imprecise (Swashbuckle annotations lag reality)] → the spec check covers existence/shape of the consumed surface only; the recorded fixtures — captured from a real instance — remain the ground truth for payload shapes, and tier 1 validates against those.
- [Spec-level checking cannot catch slskd behavioral drift under an unchanged shape] → accepted non-goal; the E2E tier plus runtime schema enforcement bound the blast radius.
- [Live MusicBrainz flakiness or rate-limiting makes the weekly job cry wolf] → tiny request budget (≤6 requests at 1 req/s), retry-once-with-backoff, and drift failures land in an issue rather than a red commit gate.
- [Recorded fixtures capture private data (usernames, IPs, share paths)] → mandatory sanitization step in the recording scripts; fixtures are reviewed before commit; slskd credentials only ever via env.
- [`slskd:latest` moves under the drift job, so runs are not reproducible] → intentional — tracking latest is the job's purpose; the report always names the exact latest version it tested.
- [Schema strictness drift: schemas could over-specify fields we don't actually consume, creating false drift alarms] → schemas model only consumed fields (mirroring today's deliberately-partial interfaces); review rule: a field enters a schema only when an adapter reads it.
- [Maintainer upgrades the live slskd instance without refreshing the pinned snapshot] → the snapshot provenance file names the pinned version; a tier-2 report includes the pinned version so staleness is visible; refreshing is a documented one-command step.

## Migration Plan

Internal, additive; no public contract changes and no deploy steps. Rollback is removing the new tier wiring. The only ordering constraint: schemas + fixtures (with recording) land before the tiers that consume them.

## Open Questions

- Which stable MusicBrainz MBIDs to pin for recording/replay (choose well-established releases/recordings unlikely to be merged or deleted; decided at implementation).
- Exact mechanism for the drift issue (e.g. `actions/github-script` vs a maintained create-or-update-issue action) — decided at implementation; requirement is only open-or-refresh semantics.
