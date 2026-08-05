# external-api-contracts — delta for slskd-contract-truth

## MODIFIED Requirements

### Requirement: Contract fixtures are recorded from real services

The system SHALL maintain frozen response fixtures recorded from the real services (not
hand-written), sanitized of private data, each carrying provenance (source, capture date,
service version where known). Repeatable recording scripts SHALL live in the repository, with
credentials supplied only via environment. Where a consumed shape depends on service states
that the public service cannot produce on demand, the repository SHALL provide a local
recording lab — real service instances orchestrated to produce each target state
deterministically — used at record time only; the commit gate SHALL remain containerless and
network-free against the frozen fixtures. Recording SHALL be scenario-complete: fixtures whose
meaning couples them to one another (a flow's events and its polls) SHALL be re-recordable
together by one scripted scenario, so no fixture set is documented as unre-recordable.

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

### Requirement: The consumed slskd API surface is pinned and checked for drift

The system SHALL declare the slskd operations it consumes as an explicit manifest — every
consumed operation, including deletion endpoints, with each operation's consumed path
parameters, query parameters, and request bodies — and SHALL keep in the repository a snapshot
of the pinned slskd version's OpenAPI document with provenance (version, capture date). A
scheduled job SHALL fetch the OpenAPI document of the latest slskd release and verify every
manifest entry still exists with a compatible shape, reporting the pinned-to-latest delta for
the consumed surface. An operation consumed by any adapter but absent from the manifest SHALL
be a contract-tier failure, so the manifest cannot silently under-declare the surface.

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

## ADDED Requirements

### Requirement: The consumed transfer-state vocabulary is witnessed and version-pinned

Every transfer `state`, `exception` spelling, queue-position shape, enqueue-rejection body, and
absence signal (the no-transfers 404) that the slskd adapters consume SHALL be witnessed by a
fixture recorded from a real slskd of the pinned version — including a genuinely queued
transfer with its queue position, a cancelled transfer, and at least one failed transfer with
its real `exception` text — and the failure classifier SHALL be calibrated against those
recorded spellings. Unit-tier stubs SHALL model only states the pinned provider can emit; a
stub modeling an unreachable state is a defect. The pinned version's reachable-state vocabulary
SHALL be recorded with provenance so a version bump forces a deliberate re-record.

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
