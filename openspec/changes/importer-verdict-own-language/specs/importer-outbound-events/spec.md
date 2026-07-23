## MODIFIED Requirements

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
