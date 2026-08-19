# module-architecture — delta

## MODIFIED Requirements

### Requirement: No shared kernel

The workspace SHALL contain no shared **model**: no source package shared between the two modules may define or export a domain type, event vocabulary, seam contract schema, or any name from either module's ubiquitous language. A model type needed by both modules MUST be duplicated in each, not extracted into a shared package.

A mechanism-only leaf package (generic infrastructure with no knowledge of either module) MAY be shared, under all of these conditions, lint-enforced:

- it imports nothing from any other workspace package;
- it carries no domain vocabulary — any module-specific identity it handles arrives as an opaque parameter supplied by the consumer;
- modules consume it only outside their `domain/` layer.

#### Scenario: Duplicated seam types

- **WHEN** both modules need a structurally identical model type (e.g. an identifier or path value)
- **THEN** each module defines its own copy and the build contains no shared package exporting that type

#### Scenario: Shared mechanism package stays a leaf

- **WHEN** the dependency lint runs over a shared mechanism package
- **THEN** any import from another workspace package, or any import of the shared package from a module's `domain/` layer, is a lint failure that breaks the build

#### Scenario: Module identity crosses into shared mechanism as data

- **WHEN** a module constructs a shared-mechanism component that must be attributable to that module (e.g. in logs or stored envelopes)
- **THEN** the module supplies its identity as an opaque value at construction, and the shared package's source contains no module name
