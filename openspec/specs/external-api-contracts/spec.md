# external-api-contracts Specification

## Purpose
TBD - created by archiving change external-api-contract-tests. Update Purpose after archive.
## Requirements
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

### Requirement: Contract fixtures are recorded from real services

The system SHALL maintain frozen response fixtures recorded from the real services (not hand-written), sanitized of private data, each carrying provenance (source, capture date, service version where known). Repeatable recording scripts SHALL live in the repository, with credentials supplied only via environment. Where a consumed shape depends on service states that the public service cannot produce on demand, the repository SHALL provide a local recording lab — real service instances orchestrated to produce each target state deterministically — used at record time only; the commit gate SHALL remain containerless and network-free against the frozen fixtures. Recording SHALL be scenario-complete: fixtures whose meaning couples them to one another (a flow's events and its polls) SHALL be re-recordable together by one scripted scenario, so no fixture set is documented as unre-recordable.

#### Scenario: Fixture conforms to the contract

- **WHEN** the contract test tier runs
- **THEN** every fixture validates against its schema, and a fixture violating its schema fails the tier

#### Scenario: Re-recording fixtures

- **WHEN** the recording script for a service is run with the required environment configuration
- **THEN** fresh sanitized fixtures with updated provenance are produced without manual payload editing

#### Scenario: A coupled fixture set re-records as one scenario

- **WHEN** the recording scenario for a flow with coupled fixtures is re-run against the lab
- **THEN** every fixture in the set is regenerated coherently in one run, with no fixture
  requiring manual reconciliation against another

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

The system SHALL declare the slskd operations it consumes as an explicit manifest — every consumed operation, including deletion endpoints, with each operation's consumed path parameters, query parameters, and request bodies — and SHALL keep in the repository a snapshot of the pinned slskd version's OpenAPI document with provenance (version, capture date). A scheduled job SHALL fetch the OpenAPI document of the latest slskd release and verify every manifest entry still exists with a compatible shape, reporting the pinned-to-latest delta for the consumed surface. An operation consumed by any adapter but absent from the manifest SHALL be a contract-tier failure, so the manifest cannot silently under-declare the surface.

#### Scenario: Latest slskd breaks a consumed operation

- **WHEN** the latest slskd release's OpenAPI document no longer offers a manifest operation with a compatible shape
- **THEN** the scheduled job fails and reports which consumed operations broke, naming the pinned and latest versions

#### Scenario: Latest slskd changes only unconsumed surface

- **WHEN** the latest slskd release changes operations outside the manifest
- **THEN** the scheduled job passes

#### Scenario: A consumed-but-undeclared operation fails the tier

- **WHEN** an adapter issues a request to an slskd operation the manifest does not declare
- **THEN** the contract tier fails naming the undeclared operation

#### Scenario: A consumed query parameter is declared and asserted

- **WHEN** the contract tier replays the transfer teardown flow
- **THEN** the asserted requests include the removal query parameter's two-phase values, and
  the manifest declares that parameter on the operation

### Requirement: The consumed transfer-state vocabulary is witnessed and version-pinned

Every transfer `state`, `exception` spelling, queue-position shape, enqueue-rejection body, and
absence signal (the no-transfers 404) that the slskd adapters consume SHALL be witnessed by a
fixture recorded from a real slskd of the pinned version — including a genuinely queued transfer
with its queue position, a cancelled transfer, and at least one failed transfer with its real
`exception` text — and the failure classifier SHALL be calibrated against those recorded spellings.
Unit-tier stubs SHALL model only states the pinned provider can emit; a stub modeling an
unreachable state is a defect. The pinned version's reachable-state vocabulary SHALL be recorded
with provenance so a version bump forces a deliberate re-record.

#### Scenario: A queued transfer is a recorded fact

- **WHEN** the contract tier replays the queued-transfer fixture through the real adapter
- **THEN** the adapter reports the queue position from the recorded shape, and the fixture's
  provenance names the slskd version that produced it

#### Scenario: Failure classification is calibrated by recorded spellings

- **WHEN** the recorded failed-transfer and rejection fixtures replay through the classifier
- **THEN** each maps to its intended source-agnostic reason, and a spelling drift in a future
  re-record fails these tests rather than silently degrading classification

#### Scenario: A stub for an unreachable state fails review-by-tier

- **WHEN** the unit tier's slskd stubs are checked against the pinned version's recorded
  reachable-state vocabulary
- **THEN** a stub claiming a state outside that vocabulary is flagged as a defect

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

### Requirement: The consumed plex.tv surface is pinned with scrubbed fixtures

The system SHALL pin the plex.tv operations the login flow consumes (PIN create, PIN check, account, accessible resources) with recorded fixtures and replay tests following the established contract tier. The recorder SHALL accommodate the flow's interactive step (pausing while a human approves the PIN in a browser) and SHALL project recorded responses to consumed fields, scrubbing every token and all account data beyond the consumed identity fields, before anything is written. Scheduled live drift checks SHALL cover at most the unauthenticated PIN operations; operations requiring a user token SHALL remain replay-only, because live-checking them would require storing a long-lived Plex credential.

#### Scenario: A recorded fixture never carries a live token

- **WHEN** the plex.tv recorder writes fixtures from a real login exchange
- **THEN** no auth token, and no account field beyond the consumed identity fields, appears anywhere in the recorded artifacts, and the tier's tests assert this

#### Scenario: Token-requiring operations are not live-drift-checked

- **WHEN** scheduled drift detection runs
- **THEN** it exercises no plex.tv operation that needs a user token, and the repository holds no long-lived Plex credential to make that possible
