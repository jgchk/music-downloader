# download-management Specification

## Purpose

Govern how a selected candidate is downloaded as a single candidate-level unit, how live transfer progress is surfaced without polluting acquisition history, how stalled or endlessly-queued transfers fail by policy, and how source-specific failures are normalized into source-agnostic reasons.

## Requirements

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

### Requirement: A candidate's transfers are identified by ownership
The system SHALL identify the transfers belonging to a candidate's download attempt through its ownership ledger — not by matching usernames and filenames against the source's full transfer list — so that transfers it does not own, and settled records from earlier attempts, cannot contribute to the attempt's outcome, progress, or stall detection.

#### Scenario: A stale record cannot fail a successful download
- **GIVEN** the source still holds a failed transfer record from an earlier attempt of the same candidate
- **WHEN** a new attempt's transfers all complete successfully
- **THEN** the download reports a completed outcome unaffected by the stale record

#### Scenario: Abandonment cancels only owned transfers
- **GIVEN** a stalled candidate download alongside an operator's manual transfer from the same user
- **WHEN** the system abandons the candidate by policy
- **THEN** only the ledger-owned transfers are cancelled

### Requirement: A doomed candidate's remaining transfers are cancelled
The system SHALL, once any of a candidate's transfers has terminally failed, cancel the candidate's remaining unfinished transfers instead of letting them run to completion, and SHALL report the candidate's failed outcome with the original failure's reason once all its transfers have settled.

#### Scenario: One failed file stops the rest
- **GIVEN** a 12-file candidate whose third file fails terminally while others are still transferring or queued
- **WHEN** the failure is observed
- **THEN** the remaining transfers are cancelled and the candidate settles as failed with the original failure's reason, not a cancelled reason

### Requirement: Completed outcomes report the source-reported on-disk location of downloaded files

The system SHALL report each file of a completed download at the location the source itself reports for that file, correlated to the download the system initiated. The reported path MUST reference the real, existing file — it MUST NOT be a location recomputed from candidate identity independently of where the source wrote. When the source reports its location in its own address space (e.g. a container path), the system SHALL map it onto the shared staging volume the system reads from. Staging-cleanup of a rejected candidate SHALL target that same reported location, so its files are actually removed.

#### Scenario: Completed file path reflects where the source wrote it

- **GIVEN** a selected candidate whose files the source writes under a layout the source alone determines (folder naming, sanitization, and collision handling internal to the source)
- **WHEN** the download completes and the system resolves the source's report of each completed file's location, correlated to the download it initiated
- **THEN** each reported file path resolves to the real file the source wrote on the shared staging volume
- **AND** the downstream validation and import steps operate on those existing paths, with no location recomputed to a different scheme

#### Scenario: Source-renamed file is still located

- **GIVEN** a completed download where the source sanitized or de-duplicated the on-disk name so it differs from the requested name
- **WHEN** the system resolves the completed file's location from the source's report
- **THEN** the reported path points at the source's actual on-disk name, not the originally requested name

#### Scenario: Rejected candidate's staged files are cleaned from their real location

- **GIVEN** a candidate whose downloaded files were staged at the source-reported location and then rejected by validation
- **WHEN** staging-cleanup runs for that candidate
- **THEN** it removes the files at that same reported location, leaving no staged residue

### Requirement: An abandoned candidate's already-completed files are cleaned from staging

When a candidate is abandoned or aborted mid-download (a stall, a queue timeout, or a cancellation), the system SHALL clean up the files the source had already completed into staging before the candidate stopped, targeting the source-reported locations of that completed subset, so no partial staged files are orphaned. The cleanup SHALL reuse the same staging-removal path a rejected candidate uses. Resolving the completed subset SHALL be best-effort: if it cannot be resolved, the system SHALL still report the abandonment as a failure with its original reason rather than turning it into an infrastructure fault.

#### Scenario: Partial completed files are cleaned when a multi-file candidate is abandoned

- **GIVEN** a multi-file candidate where some files completed into staging and others were still in flight when the candidate stalled or was cancelled
- **WHEN** the candidate is abandoned
- **THEN** the already-completed files are removed from staging at their source-reported locations, leaving no partial residue
- **AND** the abandonment is still reported as a failure with its original reason

#### Scenario: An unresolvable completed subset does not fail the abandonment

- **GIVEN** a candidate is abandoned but the source has not yet reported the locations of the files it already completed
- **WHEN** the system tears the candidate down
- **THEN** the outcome is still a failure with its original reason, not an infrastructure fault
- **AND** no partial file is left imported or mistaken for a completed download
