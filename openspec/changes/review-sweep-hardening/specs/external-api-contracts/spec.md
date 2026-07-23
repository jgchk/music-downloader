## MODIFIED Requirements

### Requirement: The consumer contract is codified as schemas

The system SHALL codify, per external dependency the adapters consume — the HTTP providers (slskd, MusicBrainz) and any **local subprocess** whose output feeds a business decision (ffprobe) — the consumer contract as runtime-checkable schemas covering every response/output shape the adapters consume. Schemas SHALL tolerate unknown fields (additive provider changes are not violations) and SHALL declare only fields the adapters actually read. Compile-time adapter types SHALL be derived from the schemas so the two cannot diverge.

#### Scenario: Provider adds a field

- **WHEN** a response contains all consumed fields plus fields unknown to the schema
- **THEN** schema validation passes

#### Scenario: Provider drops or retypes a consumed field

- **WHEN** a response is missing a consumed field or carries it with an incompatible type
- **THEN** schema validation fails, identifying the violating path

#### Scenario: A local subprocess output is consumed for a decision

- **WHEN** the ffprobe adapter reads a probe output whose consumed field (e.g. the bit-depth field, which the pinned binary may emit as `bits_per_raw_sample` or `bits_per_sample`) is absent or retyped
- **THEN** the output is parsed through the tolerant schema and a violation surfaces as a modeled infrastructure failure naming ffprobe, rather than silently degrading the quality decision
