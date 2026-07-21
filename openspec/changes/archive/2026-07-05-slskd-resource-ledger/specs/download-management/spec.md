# download-management Delta

## ADDED Requirements

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
