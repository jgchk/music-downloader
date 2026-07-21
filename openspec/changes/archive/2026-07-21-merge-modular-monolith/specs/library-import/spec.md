## ADDED Requirements

### Requirement: External verdicts arrive over the cross-module subscription seam
The system SHALL consume external validation verdicts for delivered acquisitions from the importer module's outbound event feed via a durable catch-up subscription: payloads are read tolerantly — only the acquisition id, candidate identity, verdict, and optional reasons this domain needs, ignoring unknown fields — and translated at the boundary into the native external-validation command. Redelivered or stale verdicts SHALL converge without error.

#### Scenario: A rejection verdict revives an acquisition
- **GIVEN** a fulfilled acquisition
- **WHEN** the subscription consumes a verdict event rejecting the fulfilled candidate
- **THEN** the acquisition revives into the retry ladder

#### Scenario: A redelivered verdict converges
- **GIVEN** a verdict event already processed
- **WHEN** the same event is redelivered after a crash before the checkpoint advanced
- **THEN** it is consumed without error and the acquisition's state is unchanged

#### Scenario: Unknown payload fields are ignored
- **GIVEN** a verdict event carrying fields this system does not use
- **WHEN** the event is consumed
- **THEN** the extra fields are ignored and the verdict is handled normally

#### Scenario: A stale verdict converges
- **GIVEN** an acquisition that has already moved past the delivered candidate the verdict concerns
- **WHEN** the verdict event is consumed
- **THEN** the decider converges to a no-op and the subscription's checkpoint advances
