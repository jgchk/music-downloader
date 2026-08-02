# download-management — delta for nonblocking-download-observation

## ADDED Requirements

### Requirement: Download observation blocks no other work

The system SHALL observe an in-flight download — sampling the source, judging the caller-supplied
stall and queue-wait budgets, and aggregating per-file transfers — without blocking the
processing of any other acquisition's work. Starting a download SHALL complete promptly once the
source has accepted the enqueue; the candidate-level outcome (completed, or failed with its
source-agnostic reason) SHALL be delivered asynchronously as a fact when the watch settles, and
SHALL enter the acquisition's decision path exactly as if the download had been observed
synchronously — stale-outcome rejection unchanged.

#### Scenario: A slow healthy download delays nobody

- **GIVEN** one acquisition whose multi-file download is transferring slowly but making progress
- **WHEN** another acquisition is submitted
- **THEN** the second acquisition resolves, searches, and downloads to its own outcome while the
  first is still transferring

#### Scenario: The outcome still lands after the watch settles

- **GIVEN** an acquisition whose download is being observed asynchronously
- **WHEN** the last of its transfers settles
- **THEN** the acquisition receives a single candidate-level outcome and proceeds through the
  normal decision path

### Requirement: Aborting an in-flight download takes effect promptly

The system SHALL act on an abort of an in-flight download promptly — cancelling the candidate's
owned transfers at the source and ending its watch — without waiting for the transfer to settle
on its own.

#### Scenario: An abort does not wait out the transfer

- **GIVEN** a candidate download that would take an hour to settle at the peer's pace
- **WHEN** the download is aborted
- **THEN** the owned transfers are cancelled at the source promptly, not after the transfer
  settles

### Requirement: Outcome detection does not depend on source push signals

The system SHALL detect download outcomes by its own observation of the source. A push signal or
durable success record from the source MAY accelerate detection, but outcome detection SHALL NOT
require any push notification to have been delivered — the source durably records only
successes, and its push delivery is best-effort.

#### Scenario: A lost push notification does not lose the outcome

- **GIVEN** an in-flight download whose source-side push notifications are never delivered
- **WHEN** its transfers settle
- **THEN** the system still detects and reports the candidate-level outcome
