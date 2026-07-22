# runtime-baseline Specification

## Purpose

Define the project's runtime baseline: a single, exact source of truth for the Node.js target version kept in parity across development, CI, and production, and the composed single-process shape of the application — one entry point booting both module runtimes before the web interface accepts work, one event store file per module, and one validated environment configuration surface.

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

### Requirement: The application runs as a single composed process
The system SHALL run as one Node process whose entry point first wires both module runtimes — each module's event store, subscriptions, reactors, pollers, and timers — through the composition root, and then mounts the web interface handler (SvelteKit `adapter-node`), so the process is a daemon that also serves pages. The system SHALL NOT depend on a standalone HTTP framework server, on webhook peers, or on any second service process for its core loop.

#### Scenario: One process serves the whole loop
- **WHEN** the application starts
- **THEN** both module runtimes are active and the web interface answers on the same process and port, with no other application process required

#### Scenario: Module runtimes start before the interface accepts work
- **WHEN** the entry point boots
- **THEN** the composition root has wired both modules' stores and subscriptions before the web handler begins accepting requests

### Requirement: Each module's event store is a separate database file
The process SHALL open one SQLite event store file per module, at independently configured paths, and SHALL NOT attach both files to one connection or span a transaction across them. Cross-module coordination SHALL happen only through the subscription seam, whose checkpoint may lag but never lead the producer's store.

#### Scenario: Stores are independent files
- **WHEN** the application runs
- **THEN** the downloader's and importer's events persist in two distinct database files, each written only by its owning module

#### Scenario: No cross-file transaction exists
- **WHEN** any module commits a transaction
- **THEN** that transaction touches exactly one of the two database files

### Requirement: Configuration is consolidated in one environment
The system SHALL read one environment configuration surface covering both modules and the web interface, validated at startup with precise errors, sourced from the environment per twelve-factor. Webhook-era settings (peer URLs, signing and receiver secrets) SHALL NOT be read.

#### Scenario: Invalid configuration fails startup precisely
- **GIVEN** a missing or malformed required setting for either module
- **WHEN** the process starts
- **THEN** startup fails with an error naming the offending setting

#### Scenario: Webhook-era settings are inert
- **GIVEN** an environment still carrying webhook peer URLs or secrets
- **WHEN** the process starts
- **THEN** those settings are ignored and no webhook publisher or receiver is constructed

### Requirement: Each module runtime exposes a readiness snapshot

Each module runtime SHALL expose a synchronous, side-effect-free readiness snapshot reporting whether that module is currently able to serve — reflecting in-memory runtime state (its store, reactors, and seam subscription being live and not halted), not a query computed against its event store. Reading the snapshot SHALL NOT perform I/O, SHALL NOT scan the event store, SHALL NOT reach any third-party dependency, and SHALL return a value rather than throwing. The snapshot SHALL be readable by the composed process's interface layer without importing module-internal code and without coupling one module's readiness to the other's.

#### Scenario: Snapshot reflects a healthy runtime

- **WHEN** the interface reads a booted module runtime's readiness snapshot while its store, reactors, and seam subscription are live
- **THEN** the snapshot reports the module as up, returned as a value with no I/O and no event-store access

#### Scenario: Snapshot reflects a halted runtime

- **WHEN** a module runtime's seam subscription has halted (for example, parked on a poison event) and the interface reads its readiness snapshot
- **THEN** the snapshot reports the module as down without throwing

#### Scenario: Reading readiness has no side effects

- **WHEN** the readiness snapshot is read repeatedly, including at probe frequency
- **THEN** each read is free of I/O and side effects and does not advance, mutate, or scan the module's event store
