# runtime-baseline Specification

## Purpose

Define the project's Node.js runtime baseline: a single, exact source of truth for the target version, kept on a supported LTS, held in parity across development, CI, and production, honestly reflected in the declared support range, run on supported CI actions, and kept current by automated dependency updates.

## Requirements

### Requirement: The runtime version has a single source of truth

The project SHALL declare its target Node.js runtime version in exactly one authoritative place — `.nvmrc` — pinned to an exact `major.minor.patch` version. Every other runtime surface (CI/CD jobs, local development tooling) SHALL derive the version from that source rather than restating it, so the version cannot drift between surfaces.

#### Scenario: CI derives the runtime from the single source

- **WHEN** a CI or CD job sets up Node
- **THEN** it reads the version from `.nvmrc` (via `node-version-file`) rather than hardcoding a version number in the workflow

#### Scenario: The source is an exact version, not a range

- **WHEN** `.nvmrc` is read
- **THEN** it contains a fully-qualified `major.minor.patch` version (e.g. `24.5.0`), not a bare major or a range

### Requirement: The baseline targets a supported LTS runtime

The pinned runtime SHALL be a Node.js version that is within its official support window (Active or Maintenance LTS) — never a version past its end-of-life date. The baseline SHALL be Node.js 24 (Active LTS).

#### Scenario: Pinned version is not end-of-life

- **WHEN** the baseline is evaluated against the Node.js release schedule
- **THEN** the pinned major version is still receiving official security support (not past its EOL date)

### Requirement: Development, CI, and production share the same runtime major

The runtime that runs the production image SHALL match the runtime major that CI validates and that local development targets, preserving dev/prod parity. The production `Dockerfile` SHALL pin the same Node major as `.nvmrc`, at an exact tag (not a bare `latest`).

#### Scenario: Production image matches the validated runtime

- **WHEN** the published Docker image is built
- **THEN** its base image is the same Node major that `.nvmrc` pins and that CI ran the test suite against

#### Scenario: The image tag is pinned, not floating

- **WHEN** the `Dockerfile` base image is inspected
- **THEN** it references an explicit version tag (e.g. `node:24.5.0-slim`) rather than a bare major or `node:latest`

### Requirement: The declared support range reflects what is validated

The `engines.node` constraint in `package.json` SHALL be expressed as a floor range (e.g. `>=24.0.0`) whose lower bound is a version the project actually validates in CI. It SHALL NOT claim support for a major that CI does not exercise as its floor, nor exclude the pinned runtime.

#### Scenario: The pinned runtime satisfies the declared range

- **WHEN** the `.nvmrc` version is checked against `engines.node`
- **THEN** the pinned version satisfies the declared range

### Requirement: CI actions run on a supported Actions runtime

The GitHub Actions workflows SHALL pin action versions whose declared Actions runtime is currently supported by GitHub — not a deprecated runtime. Pipelines SHALL NOT emit end-of-job Node runtime deprecation warnings from the actions they invoke.

#### Scenario: No deprecated-runtime warnings in CI

- **WHEN** a CI or CD workflow completes
- **THEN** it produces no "Node.js version is deprecated" end-of-job warning from any invoked action

### Requirement: Runtime pins are kept current automatically

Because the runtime version and base image are pinned exactly, the repository SHALL provide automated dependency updating (e.g. Renovate or Dependabot) configured to propose bumps for the pinned Node version, the Docker base image, and GitHub Actions versions, so exact pins do not silently fall behind on security patches.

#### Scenario: Automation proposes a runtime patch bump

- **WHEN** a newer patch of the pinned Node major, base image, or an action is released
- **THEN** the update automation opens a change proposal (pull request) to bump the pin, which CI validates before merge
