# source-resource-stewardship Delta

## ADDED Requirements

### Requirement: Remote resources are recorded in a durable ownership ledger
The system SHALL durably record every remote resource it creates on a music source (searches, download transfers) in an ownership ledger, keyed to the owning acquisition, before or immediately upon creation. A transfer's ledger entry SHALL be written before the enqueue request (its natural key is known in advance); a search's entry SHALL be written as soon as the source returns its identifier. Recording SHALL be idempotent so a retried effect does not duplicate entries. Each entry SHALL track whether the system still owes the source a removal.

#### Scenario: A transfer is recorded write-ahead
- **WHEN** the system enqueues a candidate's files on the source
- **THEN** a live ledger entry for each transfer exists before the enqueue request is sent

#### Scenario: A search is recorded upon creation
- **WHEN** the system creates a search and the source returns its identifier
- **THEN** a live ledger entry for the search is written before the search is polled

#### Scenario: A retried enqueue does not duplicate entries
- **GIVEN** a crash occurred after a transfer's ledger entry was written
- **WHEN** the download effect is retried and records the same transfer again
- **THEN** the ledger still holds a single entry for that transfer

### Requirement: The system acts only on remote resources it owns
The system SHALL scope all observation and mutation of source resources — transfer polling and aggregation, cancellation, record removal, search deletion — to resources present in its ownership ledger, and SHALL NOT modify or delete a resource it did not create, so that a shared source instance is safe for concurrent manual use.

#### Scenario: An operator's manual transfer is not claimed
- **GIVEN** a manual download started outside the system for the same user
- **WHEN** the system polls and aggregates its candidate's transfers
- **THEN** the manual transfer does not contribute to the candidate's outcome and is never cancelled or removed by the system

#### Scenario: Unowned resources are invisible to cleanup
- **GIVEN** searches and transfers on the source that have no ledger entry
- **WHEN** any system cleanup runs (per-path or startup)
- **THEN** those resources are untouched

### Requirement: A search is deleted from the source once harvested
The system SHALL delete its search from the source after collecting responses, both when the source reports the search complete and when the system abandons polling at its timeout (which also stops a search still running on the source). The ledger entry SHALL be marked removed on success; a failed deletion SHALL leave the entry live for later convergence and SHALL NOT fail the search outcome.

#### Scenario: A completed search is deleted after harvest
- **WHEN** a search completes and its responses are collected
- **THEN** the search is deleted from the source and its ledger entry is marked removed

#### Scenario: A timed-out search is deleted and stopped
- **GIVEN** a search still running when the polling timeout elapses
- **WHEN** the system harvests the partial responses
- **THEN** the search is deleted from the source, stopping it, and the harvested candidates are still returned

### Requirement: Transfer records are removed from the source once settled
The system SHALL remove its transfers' tracked records from the source after the transfers settle, on every settlement path — completion, failure, policy abandonment, and cancellation — marking the ledger entries removed, so records from a previous attempt can never contaminate a later attempt's outcome. Removal of an already-absent record SHALL be a tolerated no-op.

#### Scenario: Records are removed after a completed download
- **WHEN** a candidate's transfers all complete and the outcome is reported
- **THEN** the transfers' records are removed from the source and their ledger entries marked removed

#### Scenario: A later attempt sees only its own transfers
- **GIVEN** a candidate that was attempted before, whose settled records were removed
- **WHEN** the same candidate is enqueued again by a later acquisition
- **THEN** the new attempt's outcome reflects only the new transfers

### Requirement: A startup sweep converges the system's own unfinished removals
The system SHALL, at startup and before reacting to events, find ledger entries still live whose owning acquisition is terminal, remove the corresponding resources from the source (cancelling first if still active), and mark the entries removed. Entries owned by non-terminal acquisitions SHALL be left untouched. A failure on one entry SHALL NOT stop the sweep; unconverged entries remain live for the next startup.

#### Scenario: A crash-leaked transfer is retired at startup
- **GIVEN** a live ledger entry for a transfer whose acquisition is terminal
- **WHEN** the system starts
- **THEN** the transfer is cancelled if active, its record removed from the source, and the entry marked removed

#### Scenario: An in-progress acquisition's resources are left alone
- **GIVEN** a live ledger entry owned by a non-terminal acquisition
- **WHEN** the startup sweep runs
- **THEN** the entry and its resource are untouched
