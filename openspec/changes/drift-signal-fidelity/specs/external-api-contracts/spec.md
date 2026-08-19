# external-api-contracts — delta for drift-signal-fidelity

## MODIFIED Requirements

### Requirement: MusicBrainz drift is detected by live replay

A scheduled job SHALL replay the consumed MusicBrainz request set against the live service —
within the service's rate-limit and identification etiquette — and validate each response
against the shared contract schemas. The identification the job sends SHALL name a
contactable location for this project, so the request set cannot be throttled for
misidentifying itself.

#### Scenario: Live MusicBrainz response violates the contract

- **WHEN** a live response is missing or retypes a consumed field
- **THEN** the scheduled job fails, identifying the request and the violating schema path

#### Scenario: The live replay identifies itself contactably

- **WHEN** the drift job issues its anonymous MusicBrainz requests
- **THEN** each request carries a User-Agent naming this project and a location that resolves

### Requirement: Drift detection is scheduled and notifies without blocking the gate

Drift detection SHALL run automatically on a recurring schedule (at least weekly) and on
manual dispatch, SHALL NOT block commits or pull requests, and on failure SHALL open — or
update if already open — a tracking issue containing the violation details.

Each check SHALL report one of three outcomes and SHALL make that outcome machine-readable to
the workflow that invokes it: **conforms**, **drift**, or **unavailable**. Only *drift* SHALL
fail the run and open or refresh the tracking issue. *Unavailable* — the provider could not be
reached, so the contract was neither confirmed nor refuted — SHALL leave the run passing and
SHALL be reported as a warning naming the unreached target and the reason, so an inconclusive
run is never silently indistinguishable from a conforming one.

#### Scenario: Drift detected on a scheduled run

- **WHEN** a scheduled drift run fails
- **THEN** a drift tracking issue is opened, or refreshed if one is already open, with the failure details, and the commit gate is unaffected

#### Scenario: Manual drift check

- **WHEN** a maintainer dispatches the drift workflow manually
- **THEN** it runs the same checks as the scheduled run

#### Scenario: A provider cannot be reached

- **WHEN** a checked provider answers a transient failure, or no response at all, for every
  attempt the check is willing to make
- **THEN** the run passes, no drift issue is opened or refreshed, and the run reports a warning
  naming the unreached provider and the reason

#### Scenario: A provider is reached and only some requests are inconclusive

- **WHEN** some of a provider's checked requests conform and the rest are unreachable
- **THEN** the run reports the provider as unavailable, listing which requests conformed and
  which were not verified, and still opens no drift issue

#### Scenario: A consumed operation has been removed

- **WHEN** a request whose recorded fixture answered a success status now answers `404` or `410`
- **THEN** the check reports drift — not unavailability — so a removed operation stays loud

#### Scenario: A previously anonymous operation demands authentication

- **WHEN** a request the drift check issues anonymously answers `401` or `403`
- **THEN** the check reports drift, because the consumed surface changed

## ADDED Requirements

### Requirement: Live drift checks retry transient failures before concluding

A live drift check SHALL NOT conclude anything about the contract from a single transient
failure. It SHALL retry a transient outcome — a transport fault, or a status the provider uses
to signal throttling or temporary unavailability — with a backoff that honours any
`Retry-After` the provider sends, up to a bounded number of attempts and a bounded delay. When
the provider asks for a delay longer than the check is willing to wait, or the attempts are
exhausted, the check SHALL report the request as unavailable rather than as drift.

#### Scenario: A transient failure that clears on retry

- **WHEN** a provider answers a throttling status and then answers successfully on a retry
- **THEN** the check validates the successful response and reports no drift

#### Scenario: The provider names its own backoff

- **WHEN** a provider answers a transient failure carrying a `Retry-After` header
- **THEN** the check waits the interval the provider named, rather than its own default backoff

#### Scenario: The provider asks for longer than the check will wait

- **WHEN** a provider's `Retry-After` exceeds the check's ceiling
- **THEN** the check stops retrying and reports the request as unavailable, naming the
  requested delay

#### Scenario: Attempts are exhausted

- **WHEN** every attempt a check makes for a request fails transiently
- **THEN** the request is reported as unavailable, naming the last failure, and never as drift
