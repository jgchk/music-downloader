# module-architecture

Workspace layout, module boundary rules, and facade contracts for the modular monolith (design D1, D2, D9).

## ADDED Requirements

### Requirement: Bounded-context packages with isolated state

The workspace SHALL contain exactly two bounded-context packages, `downloader` and `importer`, each with its own `domain`, `application`, and `adapters` layers and its own SQLite event store file. Neither module SHALL read or write the other module's store file.

#### Scenario: Separate event store files

- **WHEN** both module runtimes are started with a configured data directory
- **THEN** the downloader persists events only to its own store file and the importer only to its own store file, and each file is readable by tooling independently of the other

#### Scenario: Cross-store access is not wired

- **WHEN** the composition root wires the module runtimes
- **THEN** no component of one module receives a connection, path, or handle to the other module's store file (the cross-module-delivery seam's read feed is the sole exception)

### Requirement: No shared kernel

The workspace SHALL contain no source package shared between the two modules. A type needed by both modules MUST be duplicated in each, not extracted into a shared package.

#### Scenario: Duplicated seam types

- **WHEN** both modules need a structurally identical type (e.g. an identifier or path value)
- **THEN** each module defines its own copy and the build contains no package imported by both modules' source

### Requirement: Wire-shaped module facades

Each module SHALL export exactly one facade entry point consisting of commands and queries whose inputs and outputs are plain serializable DTOs validated by zod schemas at the facade boundary, with expected failures returned as modeled error values per the failure taxonomy (never thrown).

#### Scenario: Facade DTOs survive serialization

- **WHEN** any facade command or query input or output is round-tripped through `JSON.parse(JSON.stringify(value))`
- **THEN** the result is deep-equal to the original and still passes the facade's zod schema

#### Scenario: Invalid facade input is a modeled error

- **WHEN** a facade command is invoked with input that fails its zod schema
- **THEN** the facade returns a modeled validation error value and does not throw

### Requirement: Facade-only imports are lint-enforced

The lint gate SHALL fail the build when an interface package (e.g. `web`) imports any module path other than that module's facade entry point, and when either module imports any path belonging to the other module.

#### Scenario: Interface package imports module internals

- **WHEN** a file in the `web` package imports a module's `application`, `domain`, or `adapters` path directly
- **THEN** lint reports a boundary violation and the gate fails

#### Scenario: Module imports its sibling

- **WHEN** any file in `downloader` imports any path in `importer`, or vice versa
- **THEN** lint reports a boundary violation and the gate fails

#### Scenario: Facade import is legal

- **WHEN** a file in the `web` package imports a module's facade entry point
- **THEN** lint passes for that import

### Requirement: No cross-module business orchestration in interfaces

Interface packages MAY read from both modules' facades to compose a view and MAY dispatch a command to either module, but SHALL NOT sequence a business workflow across both modules. Cross-module workflow SHALL occur only via the cross-module-delivery seam.

#### Scenario: Fulfillment triggers import without interface involvement

- **WHEN** an acquisition is fulfilled while no interface request is in flight
- **THEN** the corresponding import still begins, driven solely by the event seam

#### Scenario: Composed read view

- **WHEN** an interface renders a page combining acquisition progress and import review state
- **THEN** it issues independent facade queries to each module and performs no writes as part of the read
