# module-architecture Specification

## Purpose

Define the modular-monolith workspace: two isolated bounded-context packages (downloader, importer) with their own event store files and no shared kernel, wire-shaped module facades as the sole entry points for interface packages, and lint-enforced boundaries that keep cross-module coupling confined to the event seam.

## Requirements
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

### Requirement: Every first-party source tier is inside the lint and typecheck gates

The commit gate's lint and typecheck SHALL cover every first-party TypeScript source in the repository — package sources, scripts, and every test tier (unit, contract, boundaries, e2e) — with no tier excluded from either gate. Test tiers SHALL run the production rule profile except for short, named, documented carve-outs; an undocumented divergence is a defect. The architecture-pinning boundaries tier SHALL itself be inside both gates.

#### Scenario: A new tier is born inside the gates

- **WHEN** a TypeScript file is added anywhere in the repository outside generated output
- **THEN** the commit gate lints and typechecks it without configuration changes, or the gate fails naming the uncovered file

#### Scenario: A tier carve-out is named and documented

- **WHEN** a test tier's rule profile diverges from production
- **THEN** the divergence is a named rule with a documented rationale in the lint configuration, not a tier-wide exemption

### Requirement: A discarded Result is a build break

The lint gate SHALL fail when a `Result`-returning call's value is discarded — the errors-as-values contract is enforced, not aspirational. Waivers SHALL be per-site with a written justification; test tiers MAY be excluded as a whole only via a commented override naming its revisit trigger.

#### Scenario: Dropping a Result fails the gate

- **WHEN** production code calls a `Result`-returning function and ignores the returned value
- **THEN** lint fails at that site

#### Scenario: A waiver carries its justification

- **WHEN** a site legitimately consumes a Result in a way the rule cannot see
- **THEN** the site carries a per-line disable with a written justification, or the code is restructured so the rule sees the consumption

### Requirement: The production lint profile is the strictest typed tier

The production lint profile SHALL extend the strictest typed rule tiers the toolchain publishes (`strictTypeChecked` and `stylisticTypeChecked`, or their successors), not a weaker tier. Any rule disabled from those tiers SHALL carry a one-line justification comment at the disable site in the lint configuration; an unjustified disable is a defect.

#### Scenario: The profile cannot silently regress

- **WHEN** the lint configuration extends a typed rule tier weaker than the strictest published tier without a documented decision
- **THEN** review flags it as a constitutional violation, and the configuration names no such weaker tier today

#### Scenario: A carve-out carries its reason

- **WHEN** a rule from the strict tiers is disabled or downgraded
- **THEN** the disable site carries a one-line justification comment naming why the rule fails this repo

### Requirement: Gate membership is admitted, not accumulated

A new check (rule pack, analyzer, or gate step) SHALL enter the commit gate only through the admission contract in `docs/development/quality-gates.md`: the check is actionable, and its effective false-positive rate — counting every finding the loop ignores, waives without cause, or appeases — is under ten percent. Adoption of a rule pack SHALL be a one-shot rule-by-rule triage whose admission tally (rules kept, rules rejected, reasons) is recorded in the adopting change's design document.

#### Scenario: A rule pack is triaged rule-by-rule

- **WHEN** a third-party rule pack is proposed for the gate
- **THEN** every rule with findings is individually admitted (at least one genuine defect or clarity win) or rejected with a justification comment in configuration, and the tally is recorded in the adopting change

#### Scenario: A noisy check is rejected regardless of pedigree

- **WHEN** a candidate check's findings on this repository are predominantly noise
- **THEN** the check is rejected or the offending rules disabled, whatever its reputation elsewhere
