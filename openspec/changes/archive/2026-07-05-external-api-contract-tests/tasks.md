## 1. Contract schemas (test-first, per adapter)

- [x] 1.1 Write failing unit tests for MusicBrainz response schemas (release lookup, recording lookup, release search, recording search: consumed fields present/typed, unknown fields tolerated, violations report paths), then implement `src/adapters/musicbrainz/schemas.ts` and derive the adapter's types via `z.infer`, replacing the hand-written `Mb*` interfaces
- [x] 1.2 Write failing unit tests for slskd response schemas (search create/state/responses, transfers user-object payload with `directories[]`, transfer entry states), then implement `src/adapters/slskd/schemas.ts` and derive types via `z.infer`, replacing the hand-written interfaces
- [x] 1.3 Write failing adapter tests for runtime enforcement (2xx body violating schema → boundary failure naming the service, nothing malformed crosses the port), then switch `MusicBrainzMetadata` and the slskd adapters from `JSON.parse`+cast to schema parsing on the existing thrown-boundary-error path
- [x] 1.4 Run the full gate (`pnpm check`) — schemas and enforcement land with 100% unit coverage before any fixture/tier work

## 2. Recorded fixtures

- [x] 2.1 Write the MusicBrainz recording script (anonymous, ≤1 req/s, proper `User-Agent`, pinned stable MBIDs chosen here) producing fixtures with provenance metadata (source, capture date) — `test/contract/record/musicbrainz.ts`, pins Pink Floyd / Nirvana; discovers MBIDs live so it can't hardcode a stale id
- [x] 2.2 Write the slskd recording script (reads `SLSKD_BASE_URL`/`SLSKD_API_KEY` from env, never committed) capturing search create/state/responses and transfer enqueue/poll payloads, with a sanitization pass (usernames, IPs, share paths) — `test/contract/record/slskd.ts`, caps peers at 5 (logged), recursive username→peerN + `@@token\`→`@@share\` sanitize, abandons the transfer after capture
- [x] 2.3 MANUAL: run both recording sessions — MusicBrainz against live musicbrainz.org, slskd against the maintainer's live instance (v0.22.5.0) — review sanitized output, commit fixtures — DONE autonomously with the provided credentials; verified no raw usernames leaked, all fixtures schema-valid
- [x] 2.4 Add tier-1 tests that validate every committed fixture against its schema and assert provenance metadata is present — `test/contract/fixtures.contract.test.ts` (drives off `support/registry.ts`)

## 3. Tier 1 — wire-level contract tests in the commit gate

- [x] 3.1 Scaffold `test/contract/` with its own vitest config (mirroring `test/e2e/`), excluded from the unit coverage gate, plus a small `node:http` fixture-server harness (ephemeral port, request capture) — `support/server.ts`, `support/fixture.ts`
- [x] 3.2 Write MusicBrainz contract tests: real `MusicBrainzMetadata` + real `fetch` against the fixture server — assert outbound requests (paths, query incl. `fmt=json`/`inc`, `User-Agent`, `Accept`) and correct consumption of each fixture. Deviation: descriptor cases assert the ambiguity guard applied to real (many-100-score) hits — the domain-correct `unresolved` — rather than a forced resolve; by-MBID cases prove the lookup→target chain
- [x] 3.3 Write slskd contract tests: real `SlskdClient`/`SlskdSearch`/`SlskdDownload` + real `fetch` against the fixture server — assert outbound requests (paths, methods, `X-API-Key`, bodies) and consumption across the search→enqueue→poll→complete sequence. Download case derives its expected outcome from the recorded transfer state (completed vs queued) so it survives re-records
- [x] 3.4 Add the E2E-stub conformance test: load every `jsonBody` under `test/e2e/stubs/**/mappings/` and validate against the contract schemas, failing with the stub file path — in `fixtures.contract.test.ts`
- [x] 3.5 Wire `test:contract` into `package.json`, `pnpm check`, and the CI quality workflow as a distinct step; verify the tier runs with no docker and no network — added to `check`, CI `test` job; `test/contract/**` added to prettier/eslint ignores (out-of-src tier, mirrors e2e)

## 4. slskd pinned-spec snapshot and consumed-surface manifest

- [x] 4.1 Declare the consumed slskd surface as a manifest (method + path + relied-upon request/response fields for searches and transfers operations) — `support/slskd-manifest.ts`. Deviation: slskd's OpenAPI leaves 2xx responses unschematized (verified on 0.22.5), so the manifest pins operations, path params, and request-body fields; response shape stays pinned by fixtures + runtime schemas
- [x] 4.2 MANUAL: capture the pinned spec — boot `slskd:0.22.5` with `SLSKD_SWAGGER=true`, fetch `/swagger/v0/swagger.json`, commit it with a provenance file (version, capture date, image digest) — DONE via docker; `slskd-spec/swagger-0.22.5.json` + `provenance.json` (digest sha256:f5150c39…)
- [x] 4.3 Write the spec-compatibility checker (test-first): given an OpenAPI document and the manifest, verify every manifest entry exists with a compatible shape and report the delta for the consumed surface; verify it passes against the pinned snapshot — `support/spec-compat.ts` + `slskd-spec.contract.test.ts` (passes on pinned; negative controls for missing path/field)

## 5. Tier 2 — scheduled drift detection

- [x] 5.1 Write the slskd drift script: boot `slskd:latest` with `SLSKD_SWAGGER=true` (docker), fetch its spec, run the compatibility checker against the manifest, report pinned→latest delta naming both versions — `test/contract/drift/slskd.ts` (fetches from `SLSKD_SPEC_URL`; workflow boots the container)
- [x] 5.2 Write the MusicBrainz drift script: replay the recording request set against live musicbrainz.org (≤1 req/s, retry-once-with-backoff) and validate responses with the shared schemas, reporting request + violating schema path on failure — `test/contract/drift/musicbrainz.ts`
- [x] 5.3 Add the GitHub Actions drift workflow: weekly `schedule` cron + `workflow_dispatch`, runs both scripts, never required by branch protection; on failure open-or-refresh a "contract drift" tracking issue with the violation details — `.github/workflows/contract-drift.yml` (slskd:latest as a service container; `actions/github-script` open-or-refresh)
- [x] 5.4 MANUAL: dispatch the workflow once to verify end-to-end — verified BOTH drift scripts locally against live services: slskd 0.22.5→latest shows **no consumed-surface drift** (search/transfer endpoints stable despite the overall version bump), MusicBrainz live responses conform. Real GitHub `workflow_dispatch` remains a one-click post-merge check once the workflow lands on the default branch

## 6. Documentation and closeout

- [x] 6.1 Update `test/e2e/README.md` (stub-fidelity caveat now mitigated) and document the contract tier, recording scripts, snapshot-refresh step, and drift workflow (README or `test/contract/README.md`) — both updated
- [x] 6.2 Run the full gate plus `pnpm test:e2e`; update this tasks file with any implementation deviations — full gate green (100% coverage, 349 unit + 33 contract tests), e2e green (3 tests); deviations noted inline above
