## 1. WireMock external stubs

- [x] 1.1 MusicBrainz stub: a static WireMock mapping (path + query) returning a canned release JSON matching the `musicbrainz` adapter's expected wire shape for the fixture MBID (`test/e2e/stubs/musicbrainz/mappings/release.json`).
- [x] 1.2 slskd stub: WireMock mappings for search create/state/responses and download enqueue, matching the `X-API-Key` header and the `slskd` adapter's expected wire shapes.
- [x] 1.3 slskd polling as a scenario state machine: the transfer-state endpoint uses `scenarioName`/`requiredScenarioState`/`newScenarioState` so the first poll returns "in progress" and the next returns "completed" (verified: 2 real GET polls in the WireMock journal).
- [x] 1.4 Seed a real audio fixture (10s FLAC, committed at `test/e2e/fixtures/track.flac`) and align the slskd search response so the reported file resolves to the fixture's location under the shared staging root (the test seeds via the app's own `candidateStagingDir`).
- [x] 1.5 Verified: a real acquisition drives real slskd + MusicBrainz adapter HTTP calls against the stubs and a real ffmpeg decode of the seeded FLAC (imported bytes match the fixture exactly).

## 2. Compose harness

- [x] 2.1 Authored `docker-compose.test.yml`: `app` (built image, reactor + HTTP, externals → WireMock stubs, on-disk SQLite, shared `./.e2e-tmp` volume) + `mb-stub` + `slskd-stub` (WireMock, mounted mappings). The suite runs on the **host** (over the real socket) rather than as a compose `test-runner` service — simpler, and it doubles as the "point at any running instance" entry point.
- [x] 2.2 Parameterized the app via env (stub base URLs, `DATABASE_FILE`, `LIBRARY_ROOT`, `STAGING_ROOT`, ports); the app runs as the host uid so it shares the bind mount. Readiness is polled from the host (app + both stub `/__admin/mappings`) rather than via in-container healthchecks (the slim images lack curl).
- [x] 2.3 The host suite pre-seeds the shared staging volume with the fixture at the exact path the slskd stub reports, before submitting.
- [x] 2.4 Confirmed `compose up` boots the real image to a serving state (HTTP 200 on the list endpoint; both stubs healthy).

## 3. Out-of-process E2E suite (isolated from the unit run)

- [x] 3.1 Created `test/e2e/vitest.config.ts` + `acquisition.e2e.test.ts`, excluded from the root vitest run, coverage, eslint, and tsconfig; reads its target from `TARGET_BASE_URL` (verified: `pnpm run check` stays at 100% coverage).
- [x] 3.2 HTTP happy-path scenario: submits over the socket, polls to `Fulfilled`, asserts the library location — real bytes flow through real ffmpeg validation and the real filesystem import (verified: 9632-byte fixture imported to `library/Test_Artist/Test_Album_(2020)/`).
- [x] 3.3 Asserts the durable-store path is real: events persisted to an on-disk SQLite file (`.e2e-tmp/events.db` present, with WAL).
- [x] 3.4 Added `pnpm test:e2e` (`test/e2e/run.sh`: build → up → suite → teardown), usable locally and in CI; the raw suite also runs against any target via env.

## 4. CI/CD gate

- [x] 4.1 Restructured the CD `image` job: build + load the image, `pnpm install`, then run the tier against it (`E2E_SKIP_BUILD=1 pnpm test:e2e`), tearing down after.
- [x] 4.2 Made publish conditional: the E2E gate step precedes the publish step, so a gate failure fails the job and the push never runs.
- [x] 4.3 Verified the gate mechanism locally: a broken run (app cannot produce the artifact → `Exhausted`) fails the suite with a non-zero exit, which blocks publish; the green path publishes.

## 5. Docs

- [x] 5.1 Documented the tier in `test/e2e/README.md`: what it covers, how to run it locally / against a target, the CI gate, the stub-fidelity caveat, and that MCP-out-of-process and real-external verification are explicitly not covered.
