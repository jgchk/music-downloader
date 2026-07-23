# importer-outbound-events Specification

## Purpose

Define the importer module's producer-owned outbound event contract — release verdicts recorded in its own event store, consumed by the downloader over the cross-module seam, evolving additively under an in-repo contract gate. Adopted (renamed from the importer repo's outbound-events) at the modular-monolith merge.

## Requirements
### Requirement: Release verdicts are published as events in the importer's own store

Adopted from the music-importer repo's `outbound-events` capability, renamed `importer-outbound-events` on adoption (name collision with the downloader module's capability). The webhook transport is replaced by the cross-module seam: the importer module SHALL record each `release.verdict` as an event in its own event store, which the downloader module consumes via the durable catch-up subscription (see `cross-module-delivery`) — at-least-once, in recorded order, with the consumer's checkpoint holding delivery across crashes and restarts so a verdict is never lost. The payload SHALL carry the originating acquisition id, the delivered candidate's identity, the rejected verdict, and the reviewer's reasons. The published payload SHALL NOT carry the importer's internal resolution verb; renaming that verb SHALL NOT change the payload or its schema, so no consumer is affected. Redelivery of an already-consumed verdict SHALL converge as a no-op on the consumer side.

#### Scenario: A recorded verdict reaches the downloader module

- **GIVEN** a review resolved with reject-unusable-delivery
- **WHEN** the downloader module's subscription consumes the recorded verdict
- **THEN** it receives the `release.verdict` payload carrying the acquisition id, candidate identity, and reasons

#### Scenario: Verdicts survive downtime and resume in order

- **GIVEN** verdicts recorded while the process was down or the consuming subscription was halted
- **WHEN** the subscription resumes from its checkpoint
- **THEN** every recorded verdict is delivered in order and none is lost

#### Scenario: A redelivered verdict is a consumer-side no-op

- **GIVEN** a verdict already consumed by the downloader module
- **WHEN** the same verdict is redelivered
- **THEN** the consumer converges without duplicating any effect

#### Scenario: Renaming the internal verb leaves the published contract unchanged

- **GIVEN** the importer's internal resolution verb is renamed to its own language
- **WHEN** a `release.verdict` is recorded and validated against the producer-owned contract schema
- **THEN** the payload shape and schema are unchanged and the permanently recorded fixture still validates

### Requirement: The published event contract is producer-owned and additive-only

The importer module SHALL own the schema of the events it publishes across the module seam: the `release.verdict` payload SHALL be defined in a single contract schema from which a JSON Schema document is generated and committed, recorded payloads SHALL validate against it, and recorded fixtures of published events SHALL be kept permanently. A contract gate — in-repo cross-package contract tests — SHALL fail the build on any non-additive schema change; a breaking payload change SHALL be expressed as a new event type instead. The consuming module SHALL read the payload through its own tolerant, consumer-owned schema.

#### Scenario: A non-additive schema change fails the gate

- **GIVEN** a modification that removes or retypes a published field
- **WHEN** the contract gate runs
- **THEN** the build fails, pointing at the non-additive difference

#### Scenario: Frozen fixtures pin the wire format

- **GIVEN** the permanently recorded fixture of a published `release.verdict`
- **WHEN** contract tests run
- **THEN** the current schema still accepts the recorded event exactly as published
