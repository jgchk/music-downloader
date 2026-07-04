## Why

Our only end-to-end coverage today is the in-process subcutaneous tier (`src/composition/e2e.test.ts`): the app is wired as plain objects inside vitest, driven via `app.inject()` and `InMemoryTransport`, backed by `:memory:` SQLite, with every outbound port **faked at the domain level**. That means the entire adapter layer (slskd HTTP client + polling loop, MusicBrainz parsing, ffmpeg probe, filesystem library, on-disk SQLite), the composition root, config loading, real socket serialization, and the published Docker image have **zero end-to-end coverage**. A change that boots incorrectly, mis-parses a real wire response, or ships a broken image passes every current gate. We want a deterministic gate that exercises the real built image over the wire before we publish it.

## What Changes

- Add an **out-of-process E2E tier** that drives the real, built Docker image across the process boundary — **over HTTP on a real socket** — with the reactor, on-disk SQLite, and the real adapter code all running.
- Keep external systems **stubbed over HTTP** (slskd + MusicBrainz), served from the compose network, so the tier stays deterministic and a third-party outage never blocks a release. The real adapter HTTP clients run against canned wire responses; only the outermost third parties are replaced.
- Add a `docker-compose.test.yml` harness (app-under-test + `slskd-stub` + `mb-stub`) and an env-configurable test suite (`TARGET_BASE_URL`) that is **separate from the unit `vitest run`** so it never touches the 100% coverage gate.
- Add a **CI job between image build and publish** that stands up the harness, runs the tier, and **gates publish** on it.
- Explicitly **out of scope**: the MCP interface (served over stdio, exercised only by the existing in-process tier) and any live tier against real slskd/MusicBrainz (nondeterministic, credential- and ToS-bound). Neither is proposed here.

## Capabilities

### New Capabilities
- `out-of-process-e2e`: A deterministic, gating end-to-end verification tier that exercises the real built image over its real HTTP transport (a network socket) with the reactor and on-disk store running and external systems stubbed over HTTP, run in CI between image build and publish.

### Modified Capabilities
<!-- None. This adds a verification tier around the existing system; it changes no existing capability's requirements. -->

## Impact

- **New**: `docker-compose.test.yml`; HTTP stub fixtures for slskd and MusicBrainz matching the adapters' expected wire shapes; an out-of-process E2E suite driven by environment configuration; a CI job wired into the CD pipeline before the publish step.
- **No production code change**: the app already reads `SLSKD_BASE_URL` / `MUSICBRAINZ_BASE_URL` from the environment, so the harness points the real adapters at stubs with no source edit.
- **CI/CD**: the CD pipeline gains a gate; `publish` becomes conditional on the tier passing. No change to the runtime image contents or the application's public HTTP/MCP contracts.
- **No** breaking changes to any public contract; no changes to existing capability specs.
