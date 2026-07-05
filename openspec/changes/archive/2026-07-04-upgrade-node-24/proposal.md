## Why

The project pins Node 20 across every runtime surface (`.nvmrc`, `engines`, `Dockerfile`, CI), but Node 20 reached **end-of-life on 2026-04-30** — it no longer receives security patches, so the shipped `node:20-slim` image runs on an unsupported runtime. Separately, GitHub deprecated the Node 20 **Actions** runtime (runners default to Node 24 as of 2026-06-16), so the pipelines emit deprecation warnings. Moving to Node 24 (current Active LTS, supported through 2028) closes the security gap and clears the CI warnings.

## What Changes

- Bump the pinned runtime from Node 20 to Node 24 (current Active LTS) across all four surfaces: `.nvmrc`, `package.json` `engines`, `Dockerfile`, and `@types/node`.
- Establish an explicit, documented **pinning policy**: exact pin for "what runs" (`.nvmrc`, Docker image), floor range for "what we support" (`engines`).
- Bump GitHub Actions to majors that target the Node 24 Actions runtime (`actions/checkout`, `actions/setup-node`, `pnpm/action-setup`, `docker/*`), silencing the Node 20 deprecation warnings — a **separate layer** from the project runtime.
- Introduce automated runtime-dependency bumping (Renovate or Dependabot) so exact pins stay current without manual patch chores.
- Verify parity: full test suite at 100% coverage, ffmpeg audio-probe adapter tests, and the out-of-process Docker E2E all pass on Node 24 with no behavioral drift.

## Capabilities

### New Capabilities
- `runtime-baseline`: The project's runtime contract — the single-source-of-truth pinned Node version, dev/CI/production parity, the declared support range, and the currency of the CI Actions runtime.

### Modified Capabilities
<!-- None. This change introduces no behavioral requirement changes to existing capabilities;
     the application does the same thing on Node 24 as on Node 20. -->

## Impact

- **Tooling / config**: `.nvmrc`, `package.json` (`engines`, `@types/node`, devDependency lockfile), `Dockerfile`, `.github/workflows/ci.yml`, `.github/workflows/cd.yml`, plus a new Renovate/Dependabot config.
- **CI/CD**: pipelines run on Node 24; action version bumps clear deprecation warnings; published image is `node:24-slim`.
- **Runtime behavior**: none expected — no application source changes. Risk surface is Node 20→24 platform deltas against the ffmpeg / SQLite / Fastify stack, covered by the existing test pyramid and E2E gate.
- **No public contract changes**: the OpenAPI snapshot / breaking-change contract test is unaffected.
