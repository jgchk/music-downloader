## Why

Our only wire-level tests of the slskd and MusicBrainz adapters run against hand-written WireMock stubs, so nothing verifies that those stubs — or the TypeScript interfaces the adapters cast responses into — match what the real services actually send. When they drift (as already happened with the slskd transfers payload shape), the tests keep passing while the app breaks against reality. There is no codified contract, no fast isolated contract tier, and no signal when a provider changes its API.

## What Changes

- Codify the consumer contract for slskd and MusicBrainz as zod schemas (non-strict: unknown fields tolerated) covering every response shape the adapters consume, plus fixtures recorded from the real services.
- Enforce the schemas at runtime: adapters parse external responses through them, so a contract violation surfaces as a modeled infrastructure failure at the boundary instead of a downstream misbehavior.
- Add a tier-1 contract test suite — in-process, wire-level (real `fetch` against a local fixture-serving HTTP server), isolated per adapter — that runs in the commit gate (`pnpm check`) and CI, asserting both the requests each adapter sends and its consumption of contract-conforming responses.
- Validate all fixtures and all existing E2E WireMock stub payloads against the schemas, so neither can drift from the contract.
- Add a tier-2 drift-detection job on a weekly schedule (plus manual dispatch) that verifies the contract against the live world: the consumed subset of slskd's OpenAPI spec (pinned-version snapshot in-repo, compared against `slskd:latest`) and live `musicbrainz.org` responses validated against the shared schemas. Failure notifies via a GitHub issue.
- Neither provider knows about this project, so provider-verified (Pact-style) contracts are out; this follows the integration-contract-test pattern for non-cooperating providers.

## Capabilities

### New Capabilities

- `external-api-contracts`: the codified consumer contract for external services (schemas + recorded fixtures), runtime boundary validation, the per-commit isolated contract test tier, stub/fixture conformance, and scheduled live drift detection with notification.

### Modified Capabilities

<!-- none — existing capability specs are source-agnostic behavior specs; adapter behavior requirements are unchanged. Contract fidelity is introduced as its own capability. -->

## Impact

- **Code**: `src/adapters/slskd/*` and `src/adapters/musicbrainz/*` parse responses via zod schemas (new schema modules alongside the adapters); hand-written response interfaces are derived from or replaced by schema inference. No domain or application layer changes.
- **Tests**: new `test/contract/` tier with its own vitest config, wired into `pnpm check` and CI; existing adapter unit tests and E2E tier remain.
- **Artifacts in repo**: recorded fixtures, a snapshot of the pinned slskd version's `swagger.json` with provenance (version, capture date).
- **CI/CD**: new scheduled GitHub Actions workflow for tier-2 drift detection; failure opens/refreshes a GitHub issue.
- **Dependencies**: zod (already present). No new runtime dependencies expected.
- **One-time manual steps**: recording slskd fixtures against the maintainer's live instance (v0.22.5.0, credentials via env), and capturing the pinned spec by booting `slskd:0.22.5` with `SLSKD_SWAGGER=true` (the live instance has swagger disabled). MusicBrainz recording is scriptable anonymously.
