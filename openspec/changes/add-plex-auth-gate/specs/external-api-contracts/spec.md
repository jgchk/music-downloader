## MODIFIED Requirements

### Requirement: The consumer contract is codified as schemas

The system SHALL codify, per external dependency the adapters consume — the HTTP providers (slskd, MusicBrainz, plex.tv) and any **local subprocess** whose output feeds a business decision (ffprobe) — the consumer contract as runtime-checkable schemas covering every response/output shape the adapters consume. Schemas SHALL tolerate unknown fields (additive provider changes are not violations) and SHALL declare only fields the adapters actually read. Compile-time adapter types SHALL be derived from the schemas so the two cannot diverge.

#### Scenario: Provider adds a field

- **WHEN** a response contains all consumed fields plus fields unknown to the schema
- **THEN** schema validation passes

#### Scenario: Provider drops or retypes a consumed field

- **WHEN** a response is missing a consumed field or carries it with an incompatible type
- **THEN** schema validation fails, identifying the violating path

#### Scenario: A local subprocess output is consumed for a decision

- **WHEN** the ffprobe adapter reads a probe output whose consumed field (e.g. the bit-depth field, which the pinned binary may emit as `bits_per_raw_sample` or `bits_per_sample`) is absent or retyped
- **THEN** the output is parsed through the tolerant schema and a violation surfaces as a modeled infrastructure failure naming ffprobe, rather than silently degrading the quality decision

### Requirement: Adapters enforce the contract at runtime

The slskd, MusicBrainz, and plex.tv adapters SHALL validate external responses against the contract schemas at the HTTP boundary, and SHALL surface a violation as a modeled infrastructure failure attributable to the external service, rather than passing malformed data downstream.

#### Scenario: Malformed external response

- **WHEN** an external service returns a 2xx response whose body violates the contract schema
- **THEN** the operation fails at the adapter boundary as an infrastructure failure naming the service, and no malformed data reaches the application layer

## ADDED Requirements

### Requirement: The consumed plex.tv surface is pinned with scrubbed fixtures

The system SHALL pin the plex.tv operations the login flow consumes (PIN create, PIN check, account, accessible resources) with recorded fixtures and replay tests following the established contract tier. The recorder SHALL accommodate the flow's interactive step (pausing while a human approves the PIN in a browser) and SHALL project recorded responses to consumed fields, scrubbing every token and all account data beyond the consumed identity fields, before anything is written. Scheduled live drift checks SHALL cover at most the unauthenticated PIN operations; operations requiring a user token SHALL remain replay-only, because live-checking them would require storing a long-lived Plex credential.

#### Scenario: A recorded fixture never carries a live token

- **WHEN** the plex.tv recorder writes fixtures from a real login exchange
- **THEN** no auth token, and no account field beyond the consumed identity fields, appears anywhere in the recorded artifacts, and the tier's tests assert this

#### Scenario: Token-requiring operations are not live-drift-checked

- **WHEN** scheduled drift detection runs
- **THEN** it exercises no plex.tv operation that needs a user token, and the repository holds no long-lived Plex credential to make that possible
