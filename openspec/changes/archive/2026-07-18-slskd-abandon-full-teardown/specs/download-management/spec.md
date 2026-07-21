## ADDED Requirements

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
