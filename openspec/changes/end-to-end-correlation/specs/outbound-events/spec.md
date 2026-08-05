# outbound-events — delta for end-to-end-correlation

## ADDED Requirements

### Requirement: Published events carry optional correlation metadata

The downloader's published events SHALL carry an optional metadata block with the operation's
correlation id and a causation reference (see `operation-correlation`), rendered by the producer
alongside the payload and validated by the outbound schema. The block SHALL be additive under
the existing contract gate: prior fixtures without it remain valid, and consumers reading
through tolerant schemas are unaffected when it is absent.

#### Scenario: A published event carries its story

- **GIVEN** an acquisition operation carrying correlation metadata
- **WHEN** its fulfilment event is rendered onto the outbound feed
- **THEN** the published event includes the metadata block with the operation's correlation id

#### Scenario: The block is additive under the gate

- **WHEN** the schema-additivity contract gate runs against the grown schema and the historical
  fixtures
- **THEN** it passes — the block is optional and every prior fixture still validates
