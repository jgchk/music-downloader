## ADDED Requirements

### Requirement: The consumer contract is codified as schemas

The system SHALL codify, per external service (slskd, MusicBrainz), the consumer contract as runtime-checkable schemas covering every response shape the adapters consume. Schemas SHALL tolerate unknown fields (additive provider changes are not violations) and SHALL declare only fields the adapters actually read. Compile-time adapter types SHALL be derived from the schemas so the two cannot diverge.

#### Scenario: Provider adds a field

- **WHEN** a response contains all consumed fields plus fields unknown to the schema
- **THEN** schema validation passes

#### Scenario: Provider drops or retypes a consumed field

- **WHEN** a response is missing a consumed field or carries it with an incompatible type
- **THEN** schema validation fails, identifying the violating path

### Requirement: Adapters enforce the contract at runtime

The slskd and MusicBrainz adapters SHALL validate external responses against the contract schemas at the HTTP boundary, and SHALL surface a violation as a modeled infrastructure failure attributable to the external service, rather than passing malformed data downstream.

#### Scenario: Malformed external response

- **WHEN** an external service returns a 2xx response whose body violates the contract schema
- **THEN** the operation fails at the adapter boundary as an infrastructure failure naming the service, and no malformed data reaches the application layer

### Requirement: Contract fixtures are recorded from real services

The system SHALL maintain frozen response fixtures recorded from the real services (not hand-written), sanitized of private data, each carrying provenance (source, capture date, service version where known). Repeatable recording scripts SHALL live in the repository, with credentials supplied only via environment.

#### Scenario: Fixture conforms to the contract

- **WHEN** the contract test tier runs
- **THEN** every fixture validates against its schema, and a fixture violating its schema fails the tier

#### Scenario: Re-recording fixtures

- **WHEN** the recording script for a service is run with the required environment configuration
- **THEN** fresh sanitized fixtures with updated provenance are produced without manual payload editing

### Requirement: An isolated wire-level contract tier runs in the commit gate

The system SHALL provide a contract test tier, isolated per adapter, that exercises each real adapter over real HTTP against a local server serving the recorded fixtures — asserting both the requests the adapter sends (method, path, query, headers, body) and its consumption of contract-conforming responses. The tier SHALL run in the full commit gate and CI without requiring containers or network access, and SHALL be excluded from the unit coverage gate.

#### Scenario: Adapter sends a non-conforming request

- **WHEN** an adapter change alters a request's path, method, authentication header, or query contrary to the contract
- **THEN** the contract tier fails on that adapter

#### Scenario: Commit gate without external infrastructure

- **WHEN** the full gate runs on a machine with no docker and no network access to slskd or MusicBrainz
- **THEN** the contract tier still runs and passes against the frozen fixtures

### Requirement: E2E stub payloads conform to the contract

The system SHALL validate the response payloads of the E2E WireMock stub mappings against the contract schemas, so the E2E tier's doubles cannot drift from the contract.

#### Scenario: Stub payload violates the contract

- **WHEN** a WireMock stub mapping defines a response body that violates the corresponding schema
- **THEN** the contract tier fails, identifying the stub file

### Requirement: The consumed slskd API surface is pinned and checked for drift

The system SHALL declare the slskd operations it consumes as an explicit manifest, and SHALL keep in the repository a snapshot of the pinned slskd version's OpenAPI document with provenance (version, capture date). A scheduled job SHALL fetch the OpenAPI document of the latest slskd release and verify every manifest entry still exists with a compatible shape, reporting the pinned-to-latest delta for the consumed surface.

#### Scenario: Latest slskd breaks a consumed operation

- **WHEN** the latest slskd release's OpenAPI document no longer offers a manifest operation with a compatible shape
- **THEN** the scheduled job fails and reports which consumed operations broke, naming the pinned and latest versions

#### Scenario: Latest slskd changes only unconsumed surface

- **WHEN** the latest slskd release changes operations outside the manifest
- **THEN** the scheduled job passes

### Requirement: MusicBrainz drift is detected by live replay

A scheduled job SHALL replay the consumed MusicBrainz request set against the live service — within the service's rate-limit and identification etiquette — and validate each response against the shared contract schemas.

#### Scenario: Live MusicBrainz response violates the contract

- **WHEN** a live response is missing or retypes a consumed field
- **THEN** the scheduled job fails, identifying the request and the violating schema path

### Requirement: Drift detection is scheduled and notifies without blocking the gate

Drift detection SHALL run automatically on a recurring schedule (at least weekly) and on manual dispatch, SHALL NOT block commits or pull requests, and on failure SHALL open — or update if already open — a tracking issue containing the violation details.

#### Scenario: Drift detected on a scheduled run

- **WHEN** a scheduled drift run fails
- **THEN** a drift tracking issue is opened, or refreshed if one is already open, with the failure details, and the commit gate is unaffected

#### Scenario: Manual drift check

- **WHEN** a maintainer dispatches the drift workflow manually
- **THEN** it runs the same checks as the scheduled run
