# importer-outbound-events — delta for end-to-end-correlation

## ADDED Requirements

### Requirement: Published verdicts carry optional correlation metadata

The importer's published `release.verdict` events SHALL carry an optional metadata block with
the operation's correlation id and a causation reference (see `operation-correlation`),
rendered by the producer alongside the payload and validated by the published schema. The block
SHALL be additive under the existing contract gate: prior fixtures without it remain valid, and
the consuming module's tolerant reader is unaffected when it is absent. Where the verdict's
operation originated from a consumed downloader event, the correlation id SHALL be the one that
crossed the seam — so the full story downloader → importer → verdict → downloader shares one
id.

#### Scenario: A verdict continues the cross-seam story

- **GIVEN** an import whose intake adopted a downloader-minted correlation id
- **WHEN** its review is resolved and the verdict is published
- **THEN** the published verdict's metadata carries that same correlation id verbatim

#### Scenario: The block is additive under the gate

- **WHEN** the contract gate runs against the grown schema and the frozen verdict fixtures
- **THEN** it passes — the block is optional and every prior fixture still validates
