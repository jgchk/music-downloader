## Context

The system already ships a subcutaneous system test (`src/composition/e2e.test.ts`, the "D4 tier"): the full app graph is constructed as objects inside vitest and driven via `app.inject()` (Fastify, no socket), `InMemoryTransport` (MCP, no stdio), and `:memory:` SQLite. Every outbound port is faked at the **domain** level (`search.search` returns `Candidate[]`; `download.download` returns a `DownloadResult`).

Consequently the following ship untested end-to-end:

- the real adapter layer — `src/adapters/slskd/*` (HTTP client + transfer polling loop), `src/adapters/musicbrainz/*` (HTTP + parse), `src/adapters/ffmpeg/*` (subprocess probe), `src/adapters/filesystem/*` (staging/library writes);
- the on-disk SQLite store (schema, file I/O) — tests use `:memory:`;
- the composition root and 12-factor config load (`src/composition/index.ts`, `config.ts`);
- real socket serialization and the published Docker image (boot, `ffmpeg` presence, env validation, SIGTERM).

This change adds an out-of-process tier over **HTTP only**. The MCP interface is served over stdio (`mcpServer.connect(new StdioServerTransport())`); driving it out-of-process would require spawning a self-contained instance (the event bus is in-process by design — D7 — so a stdio process cannot share the HTTP container's reactor) and routing the logger off stdout to avoid corrupting the JSON-RPC frame stream. That is deliberately excluded here to keep the tier simple and the change free of production edits; MCP remains covered by the in-process subcutaneous tier.

## Goals / Non-Goals

**Goals:**

- Exercise the real, published image over its real HTTP transport (a socket) with the reactor, on-disk store, and real adapter code all running.
- Keep the tier deterministic: no live third-party dependency; a slskd/MusicBrainz outage cannot fail it.
- Gate publish on the tier, positioned after image build and before publish.
- Keep the tier out of the unit `vitest run` and its 100% coverage measurement.
- Require **no production-code change** — drive everything through existing env seams.

**Non-Goals:**

- Out-of-process testing of the MCP interface (stdio; still covered in-process). Would pull in a self-contained-instance topology and a logger-destination change — excluded here.
- A live tier against real slskd/MusicBrainz (nondeterministic, credential- and ToS-bound).
- Real Soulseek downloads or any assertion over the real P2P network.
- Any change to public HTTP/MCP contracts or existing capability specs.

## Decisions

### Stub externals over HTTP rather than run the real systems

slskd rides the Soulseek P2P network — availability, peer, and speed are nondeterministic, and automated downloads are credential- and ToS-bound; MusicBrainz is a rate-limited third party that can be down. Gating a release on either is a trap. The app already reads `SLSKD_BASE_URL`/`SLSKD_API_KEY` and `MUSICBRAINZ_BASE_URL`/`MUSICBRAINZ_USER_AGENT` from the environment, and both externals speak HTTP/JSON — so pointing the app at HTTP stubs in the compose network requires **zero production change** and still runs the real adapter clients, polling loops, and parsers against canned wire responses.

- **Alternative — real externals:** rejected for the gate (flaky, blocks releases, legal exposure). Out of scope here.
- **Trade-off:** stubs are only as faithful as we make them; drift from the real wire format yields false green. Accepted for a deterministic gate — the tier verifies *our* composition and adapter code against a fixed contract, not the third parties' current behavior.

### HTTP only; MCP stays in-process for now

The HTTP interface is a real network listener, so the same env-configured suite can target the compose app, a dev instance, or staging by pointing `TARGET_BASE_URL` at it. MCP is stdio-only and would require a self-contained spawned instance plus a logger-to-stderr production change to keep stdout as pure JSON-RPC. We exclude it to keep this change to test/CI infrastructure with no source edits; the in-process subcutaneous tier continues to cover MCP.

- **Alternative — include MCP out-of-process now:** deferred; larger surface (spawn topology + logger destination wiring) for a transport the in-process tier already exercises.

### Env-configurable suite, separate from the unit run

The suite reads its target from the environment (`TARGET_BASE_URL`) so the same tests run against the compose app, a local dev instance, or a staging box. It lives outside `src/**/*.test.ts` (or is excluded from the vitest `include`) so the 100% unit-coverage gate neither requires nor measures it.

### Stub server = WireMock standalone

The decision hinges on the slskd transfer-polling flow: the same `GET transfer` endpoint must return "in progress" on early polls, then "completed" later. WireMock models this natively as a **named scenario state machine expressed entirely in version-controlled JSON mappings** (`scenarioName` + `requiredScenarioState` + `newScenarioState`) — no code, explicit transitions, PR-reviewable. The official `wiremock/wiremock` image mounts a host dir with `mappings/` and `__files/`; matching covers path, query, and headers (the slskd API-key header and the MusicBrainz User-Agent are first-class). MusicBrainz is the easy half — a single static mapping — so one tool covers both stubs.

- **Runner-up — MockServer:** equally containerizable; sequences via `times.remainingTimes`, but that encodes "how many polls" as a count rather than modeling the state transition — less self-documenting. Solid fallback.
- **Rejected — Prism** (stateless: cannot return in-progress→completed on one endpoint); **msw** (in-process Node interception — wrong layer for an out-of-process container serving the app's real HTTP adapter); **mountebank/smocker** (round-robin cycling *loops back* to the first response, so an unbounded poll wraps "completed" → "in progress" — fragile).
- **Trade-off:** WireMock is a JVM container (~1–2s startup, heavier RAM). Mitigated by a compose healthcheck; the scenario model advances on request (not wall-clock), which is exactly the determinism we want for polling.

### Validation runs on real bytes — real ffmpeg, seeded fixture

ffmpeg has **no HTTP stub seam**: the probe adapter `spawn`s a real `ffmpeg -f null` decode-to-null pass plus `ffprobe` on a file path (`src/adapters/ffmpeg/{runner,probe}.ts`); the only seam is which binary. Faking it would mean swapping the binary, which means the image under test is no longer the published image — violating the tier's premise. Moreover the happy path **cannot reach Fulfilled without real bytes**: the slskd adapter reports completed files at a staging path, decode-to-null must pass (`decodedCleanly: true`), and the library adapter imports the file; with no real file, validation rejects and the acquisition retries/exhausts. So real ffmpeg is entailed, not optional.

The harness therefore commits a **tiny real audio fixture** (~1s silent FLAC, a few KB) and pre-seeds it onto the shared staging volume — mimicking what real slskd's shared download dir does, since a WireMock responder returns JSON but writes no files. The one coordination point: the seeded file's location must match what the adapter computes (`candidateStagingDir(stagingRoot, candidate)` + `remoteFilename(...)`), so the slskd-stub's search response and the fixture path must agree. Bonus: real bytes flowing through pulls the **filesystem library-import adapter** into real coverage too, in the same happy path. First cut asserts the happy path only; a corrupt-file fixture proving validation *rejection* is a deferred follow-up.

### Harness = docker-compose.test.yml

Services: `app` (built image under test, reactor + HTTP, externals → WireMock stubs, on-disk SQLite, shared `./.e2e-tmp` bind mount for staging/library/db), `slskd-stub` and `mb-stub` (WireMock, file-based mappings). The suite runs on the **host** (not as a compose `test-runner` service) driving `app` over `localhost:3000` — simpler, and it doubles as the "point at any running instance via `TARGET_BASE_URL`" entry point; because it shares the bind mount it seeds the fixture and inspects the imported library + on-disk SQLite directly. The app container runs as the host uid so it can read/write the shared mount across differing CI runner uids. CI: `build image → run tier → tear down → publish (only if green)`.

## Risks / Trade-offs

- **Stub fidelity drift** (stub diverges from real slskd/MusicBrainz wire format → false green) → derive stubs from captured real responses and the adapters' expected shapes; note explicitly that this tier does not verify real-world contract fidelity.
- **Flake from timing** (reactor async completion vs. test polling) → poll-with-timeout on terminal state (as the current subcutaneous test does with `vi.waitFor`), not fixed sleeps.
- **CI slowness** (compose up + image boot adds minutes) → single compose bring-up per run; keep the suite small and focused on seams the unit tiers can't reach.
- **MCP coverage gap out-of-process** (real MCP transport + its container boot path stay unverified end-to-end) → accepted; the in-process subcutaneous tier covers the MCP interface, and a future change can add the out-of-process MCP path if warranted.

## Migration Plan

Additive only. New harness, stubs, suite, and a CI job; no production edits. Rollback is removing the CI gate and files; no runtime image or contract change to revert.

## Open Questions

- _Resolved: stub server → WireMock standalone (file-based scenario state machine for the slskd polling sequence); see Decisions._
- _Resolved: validation runs on real bytes via real ffmpeg + a seeded audio fixture — entailed by the happy path, not optional; corrupt-file rejection deferred; see Decisions._
- None outstanding.
