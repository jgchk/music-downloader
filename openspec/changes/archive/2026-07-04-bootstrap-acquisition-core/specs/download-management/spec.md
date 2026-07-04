## ADDED Requirements

### Requirement: A candidate downloads as a single unit
The system SHALL download a selected candidate at candidate granularity, aggregating any per-file transfers into one candidate-level outcome of either completed or failed.

#### Scenario: Multi-file release completes
- **GIVEN** a selected candidate that is a 12-file release
- **WHEN** all 12 files transfer successfully
- **THEN** the download produces a single completed outcome for the candidate

#### Scenario: Partial transfer fails the candidate
- **GIVEN** a selected candidate that is a 12-file release
- **WHEN** the source peer drops after 7 files
- **THEN** the download produces a single failed outcome for the candidate

### Requirement: Transfer progress is observable but not part of the acquisition history
The system SHALL surface live transfer progress (bytes, percentage, queue position) through a read model, and SHALL NOT record progress updates as acquisition events.

#### Scenario: Progress is queryable during a transfer
- **GIVEN** a candidate that is transferring
- **WHEN** the caller queries progress
- **THEN** the current percentage and queue position are returned
- **AND** no progress update appears in the acquisition's recorded history

### Requirement: Stalled or hopelessly-queued transfers fail by policy
The system SHALL abandon a transfer that makes no progress within the download policy's stall timeout, or that remains queued beyond the download policy's maximum queue wait, and report it as a failed outcome.

#### Scenario: Stalled transfer times out
- **GIVEN** a download policy with a stall timeout
- **WHEN** a transfer makes no progress for longer than the timeout
- **THEN** the transfer is abandoned and reported as failed with a stalled reason

#### Scenario: Endless queue is abandoned
- **GIVEN** a download policy with a maximum queue wait
- **WHEN** a candidate stays queued beyond that wait
- **THEN** the transfer is abandoned and reported as failed with a queue-timeout reason

### Requirement: Failure outcomes carry a source-agnostic reason
The system SHALL translate source-specific transfer failures into a small, source-agnostic reason (peer unavailable, stalled, queue timeout, transfer error, file unavailable, cancelled) attached to the failed outcome.

#### Scenario: Offline peer is normalized
- **GIVEN** a candidate whose source peer has gone offline
- **WHEN** the transfer fails
- **THEN** the failed outcome carries a peer-unavailable reason
