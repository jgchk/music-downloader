# acquisition-lifecycle Delta

## MODIFIED Requirements

### Requirement: An acquisition can be cancelled
The system SHALL allow a non-terminal acquisition to be cancelled, after which it performs no further searches, downloads, or imports. Cancelling an acquisition whose candidate transfer is in flight SHALL abort that transfer at the source; the acquisition SHALL remember the pending candidate until its transfer settles so the settlement can be cleaned up.

#### Scenario: Cancelling in flight
- **GIVEN** an acquisition that is currently downloading
- **WHEN** the caller cancels it
- **THEN** the acquisition reaches a terminal cancelled state and no further work is performed

#### Scenario: Cancelling aborts the in-flight transfer at the source
- **GIVEN** an acquisition that is currently downloading
- **WHEN** the caller cancels it
- **THEN** the in-flight transfers are cancelled at the source rather than left to run to completion

### Requirement: Stale external outcomes are ignored
The system SHALL reject an external outcome (such as a late download result) that does not correspond to the acquisition's current state — except that a download settlement arriving for a cancelled acquisition's still-pending candidate SHALL reject that candidate (triggering its staging cleanup) while the acquisition remains cancelled; any further settlement reports for that candidate are then ignored.

#### Scenario: Settlement after cancellation rejects the pending candidate
- **GIVEN** an acquisition cancelled while its candidate's transfer was in flight
- **WHEN** the transfer's settlement (completed or failed) is reported afterwards
- **THEN** the pending candidate is rejected, its staged files become eligible for cleanup, and the acquisition remains cancelled

#### Scenario: Duplicate settlement after cleanup is ignored
- **GIVEN** a cancelled acquisition whose pending candidate has already been rejected
- **WHEN** another settlement report arrives for that candidate
- **THEN** the report is ignored and the acquisition remains cancelled
