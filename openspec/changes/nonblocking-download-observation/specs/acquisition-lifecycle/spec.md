# acquisition-lifecycle — delta for nonblocking-download-observation

## ADDED Requirements

### Requirement: No acquisition's in-flight work delays another

The system SHALL NOT allow any single acquisition's in-flight work — healthy or failing, however
long it runs — to delay the processing of other acquisitions' events, effects, or scheduled
retries. This strengthens the existing failure-isolation requirement to cover healthy
long-running work: a download that transfers for an hour holds up nothing but its own
acquisition.

#### Scenario: Acquisitions flow past an hour-long download

- **GIVEN** one acquisition mid-download at a slow peer's pace
- **WHEN** other acquisitions are submitted and their effects are due
- **THEN** each proceeds through resolution, search, download, and import at its own pace

#### Scenario: Scheduled retries fire while a download is in flight

- **GIVEN** one acquisition mid-download and another acquisition parked on a retryable fault
  whose retry is due
- **WHEN** the retry's due time passes
- **THEN** the parked effect is retried on schedule, not after the download settles

### Requirement: The lifecycle records an honest downloading phase

The system SHALL record, as a fact in the acquisition's history, that a selected candidate's
download started — once the source has accepted the enqueue. The acquisition status read model
SHALL expose a downloading phase while the download is in flight, and the history SHALL narrate
the start as an additive entry kind (`download-started`), so a consumer can tell a transferring
acquisition from one that merely selected a candidate. These SHALL be additive facade schema
members; existing consumers remain valid tolerant readers. Live transfer progress remains a read
model and SHALL NOT appear in history (existing requirement, unchanged).

#### Scenario: A transferring acquisition is distinguishable from a selected one

- **GIVEN** an acquisition whose selected candidate's files the source has accepted and begun
  transferring
- **WHEN** its status is read
- **THEN** the status reflects a downloading phase and the history contains a
  `download-started` entry after the selection

#### Scenario: Pre-existing acquisitions need no migration

- **WHEN** the status of an acquisition recorded before this change is read
- **THEN** its history folds without error, without a `download-started` entry for attempts that
  never recorded one

## MODIFIED Requirements

### Requirement: An acquisition can be cancelled

The system SHALL allow a non-terminal acquisition to be cancelled, after which it performs no
further searches, downloads, or imports. Cancelling an acquisition whose candidate transfer is
in flight SHALL abort that transfer at the source promptly — without waiting for the transfer to
settle on its own; the acquisition SHALL remember the pending candidate until its transfer
settles so the settlement can be cleaned up.

#### Scenario: Cancelling in flight

- **GIVEN** an acquisition that is currently downloading
- **WHEN** the caller cancels it
- **THEN** the acquisition reaches a terminal cancelled state and no further work is performed

#### Scenario: Cancelling aborts the in-flight transfer at the source

- **GIVEN** an acquisition that is currently downloading
- **WHEN** the caller cancels it
- **THEN** the in-flight transfers are cancelled at the source rather than left to run to
  completion

#### Scenario: Cancellation is not delayed by the transfer it aborts

- **GIVEN** an acquisition whose download would take an hour to settle at the peer's pace
- **WHEN** the caller cancels it
- **THEN** the abort reaches the source promptly, not after the transfer settles on its own
