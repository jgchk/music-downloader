## MODIFIED Requirements

### Requirement: Transfer records are removed from the source once settled
The system SHALL remove its transfers' tracked records from the source after the transfers settle, on every settlement path — completion, failure, policy abandonment, and cancellation — marking the ledger entries removed, so records from a previous attempt can never contaminate a later attempt's outcome. When a transfer is still in flight at teardown, cancelling it MAY leave a terminal-but-still-tracked record at the source; the system SHALL confirm the record is actually gone — removing the now-terminal record if it persists — before marking its ledger entry removed. A ledger entry whose record cannot be confirmed removed SHALL be left live so the startup sweep converges it, rather than marked removed. Removal of an already-absent record SHALL be a tolerated no-op.

#### Scenario: Records are removed after a completed download
- **WHEN** a candidate's transfers all complete and the outcome is reported
- **THEN** the transfers' records are removed from the source and their ledger entries marked removed

#### Scenario: A later attempt sees only its own transfers
- **GIVEN** a candidate that was attempted before, whose settled records were removed
- **WHEN** the same candidate is enqueued again by a later acquisition
- **THEN** the new attempt's outcome reflects only the new transfers

#### Scenario: An abandoned candidate's in-flight transfers leave no lingering record
- **GIVEN** a candidate abandoned (stalled, queue-timed-out, or cancelled) with some transfers still in flight
- **WHEN** its teardown cancels those transfers at the source
- **THEN** each cancelled transfer's now-terminal record is removed from the source, leaving no lingering cancelled record
- **AND** a ledger entry whose record is not confirmed gone is left live so the startup sweep retires it, rather than being marked removed
