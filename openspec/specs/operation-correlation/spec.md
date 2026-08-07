# operation-correlation Specification

## Purpose

Make one operation followable through the whole system: define the correlation/causation identity pair, where each id is minted and rewritten, how the pair rides commands, events, logs, and the cross-context seam, and the additive rules that let it retrofit onto stores that predate it.

## Requirements
### Requirement: Every unit of work carries the correlation/causation pair

Every unit of work SHALL carry a correlation id — the story identifier, minted exactly once at the operation's outermost trigger and copied verbatim through every subsequent hop — and a causation reference identifying its immediate parent, rewritten at each hop. When the parent is a stored event, the causation reference SHALL be that event's store coordinates rather than a newly minted identifier. Correlation ids SHALL use a W3C-trace-id-compatible format. The terms SHALL mean exactly this — correlation = story, causation = parent — everywhere in code, logs, and docs.

#### Scenario: A command's events inherit the story and point at their trigger

- **WHEN** a request-minted command is decided and its events are appended
- **THEN** each event's metadata carries the request's correlation id and a causation reference to the command's context

#### Scenario: A reactor-issued follow-up continues the story

- **GIVEN** a stored event carrying correlation metadata
- **WHEN** the reactor dispatches its effect and a follow-up command produces further events
- **THEN** those events carry the same correlation id verbatim, with causation referencing the triggering stored event's coordinates

#### Scenario: Non-HTTP triggers mint fresh stories

- **WHEN** a unit of work starts without an inbound request — a poll tick, the intake scanner, boot re-emit, an operator redrive
- **THEN** a fresh correlation id is minted at that trigger and flows exactly as a request-minted one does

### Requirement: The pair is carried by the shell, never the domain

Correlation and causation SHALL live in command context and event metadata only. Deciders, evolve functions, and every other domain-layer construct SHALL NOT receive, read, or emit either id; propagation SHALL be performed by application-layer infrastructure at the unit-of-work seam.

#### Scenario: The domain is blind to identity plumbing

- **WHEN** the domain layer's inputs and outputs are inspected across both modules
- **THEN** no domain signature or event payload names correlation or causation — the pair exists only in metadata the shell attaches

### Requirement: One operational id crosses the context seam

A consuming context SHALL adopt the producer's correlation id, carried in the published event's metadata, as the operational story id for the work the consumption triggers — its causation referencing the consumed event — so one id follows the operation across both stores. The anti-corruption layer SHALL translate the domain model only; it SHALL NOT re-mint or translate the observability envelope. When a consumed event carries no metadata (an older producer or a pre-change event), the consumer SHALL mint fresh and proceed — absence degrades the trace, not the work. Business provenance identifiers remain separate concepts, unaffected by this capability.

#### Scenario: The story survives the seam

- **GIVEN** a downloader event published with correlation metadata
- **WHEN** the importer consumes it and runs its intake
- **THEN** the importer's resulting events carry the downloader-minted correlation id verbatim, with causation referencing the consumed event

#### Scenario: A metadata-less event still integrates

- **WHEN** the consumer reads a published event without the metadata block
- **THEN** consumption proceeds unchanged with a freshly minted story id

### Requirement: Log lines are joinable to their unit of work

Within a unit of work, structured log lines SHALL carry the correlation id and the work's subject identity (the stream id where one exists), bound once per unit of work via child loggers — request-scoped at the web layer, per-dispatch in reactors and the download supervisor — and inherited by adapters through the loggers they are already injected with. Adapter code SHALL NOT construct or manage correlation state itself. Ids SHALL NOT appear in user-visible interface text.

#### Scenario: An adapter line joins its acquisition

- **WHEN** a source adapter logs during an effect dispatched for an acquisition
- **THEN** the line carries the correlation id and stream identity bound by the dispatch, without the adapter having handled either

#### Scenario: A request's lines share one id

- **WHEN** the web layer serves one request that reads facades and logs several lines
- **THEN** every line of that request carries the same request-minted correlation id

### Requirement: Correlation retrofits additively and is never fabricated

Correlation and causation metadata SHALL be optional in every reader, indefinitely. Historical events SHALL NOT be backfilled; upcasters SHALL NOT fabricate ids; published-contract growth SHALL be additive under the existing contract gates. Any correlation-keyed lookup SHALL be a rebuildable projection, never a source of truth.

#### Scenario: Pre-change history reads unchanged

- **WHEN** streams written before this capability are folded, projected, or replayed through upcasters
- **THEN** behavior is identical to today, with no fabricated metadata and no reader error

#### Scenario: Published contracts stay compatible

- **WHEN** the additivity contract gates run against the grown published schemas
- **THEN** they pass — the metadata block is optional and prior fixtures still parse
