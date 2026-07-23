# source-resource-stewardship Specification

## Purpose

Govern how the system stewards the remote resources it creates on a shared music source — searches and download transfers — through a durable ownership ledger. It records what it owns, acts only on its own resources so a shared source stays safe for concurrent manual use, removes searches and settled transfer records once they are no longer needed, and converges its own unfinished removals on startup.

## Requirements

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

The system SHALL delete its search from the source only after harvesting a search the source has confirmed complete. A search the system abandons — because the polling deadline elapsed while the search was still in progress, or because the harvest was contradicted by the source's bookkeeping — SHALL NOT be deleted mid-flight (deleting a running search corrupts the source's own search task); it is left to finish on the source, and its live ledger entry is retired by the startup sweep. The ledger entry SHALL be marked removed on a successful deletion; a failed deletion SHALL leave the entry live for later convergence and SHALL NOT fail the search outcome.

#### Scenario: A completed search is deleted after harvest

- **WHEN** a search completes and its responses are collected
- **THEN** the search is deleted from the source and its ledger entry is marked removed

#### Scenario: An abandoned in-progress search is left for the sweep

- **GIVEN** a search still running on the source when the polling deadline elapses
- **WHEN** the system abandons the search with an infrastructure fault
- **THEN** no delete is issued against the running search
- **AND** its ledger entry stays live, so the startup sweep later removes the (by then finished) search from the source

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
