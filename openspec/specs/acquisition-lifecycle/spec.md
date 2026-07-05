# acquisition-lifecycle Specification

## Purpose

Govern the autonomous lifecycle of an acquisition: from accepting a musical intent, through the strictly sequential "next best version" walk over ranked candidates, bounded re-search, and terminal outcomes (fulfilled, exhausted, cancelled). Ensures processing is durable across restarts and rejects stale external outcomes.
## Requirements
### Requirement: Submitting a musical intent starts an acquisition
The system SHALL accept a musical request together with optional quality, match, retry, and download policies, and SHALL begin an autonomous acquisition that runs to a terminal outcome without further user interaction.

#### Scenario: A new request is accepted
- **GIVEN** a caller who wants a specific album
- **WHEN** they submit the request with a quality policy
- **THEN** the system creates an acquisition in a pending state and returns its identifier
- **AND** unspecified policies fall back to configured defaults

### Requirement: Candidates are attempted one at a time
The system SHALL attempt at most one candidate download at a time for a given acquisition, in ranked order, so that "next best version" is a strict sequential walk.

#### Scenario: Only one download is in flight
- **GIVEN** an acquisition with a ranked list of candidates
- **WHEN** the highest-ranked candidate is selected
- **THEN** no other candidate for that acquisition is downloading concurrently

### Requirement: A failed candidate falls through to the next best
The system SHALL, when a candidate's download or validation fails, reject that candidate and select the next-best remaining candidate, without abandoning the acquisition.

#### Scenario: Download failure advances the walk
- **GIVEN** an acquisition currently attempting candidate A with candidates B and C remaining
- **WHEN** candidate A's download fails
- **THEN** candidate A is rejected and candidate B is selected next

#### Scenario: Validation failure advances the walk
- **GIVEN** an acquisition whose downloaded candidate A fails validation
- **WHEN** the validation verdict is recorded
- **THEN** candidate A is rejected and the next-best candidate is selected

### Requirement: Exhausting the working set triggers a bounded re-search
The system SHALL, when no candidates remain and the retry policy budget is not spent, request a fresh search round and merge newly-found candidates with any untried ones, excluding previously-rejected candidates.

#### Scenario: Re-search rescues an acquisition
- **GIVEN** an acquisition whose ranked candidates have all been rejected and a retry budget that is not spent
- **WHEN** the working set becomes empty
- **THEN** the system requests a new search round rather than giving up
- **AND** candidates already rejected are not attempted again

### Requirement: An acquisition is exhausted when options and budget run out
The system SHALL mark an acquisition as exhausted when the working set is empty and either a fresh search round produced no new candidates or the retry policy budget is spent.

#### Scenario: No new candidates after re-search
- **GIVEN** an acquisition that has re-searched and found nothing new
- **WHEN** the working set is empty
- **THEN** the acquisition reaches a terminal exhausted state

#### Scenario: Retry budget spent
- **GIVEN** an acquisition that has reached its maximum search rounds
- **WHEN** the working set empties again
- **THEN** the acquisition reaches a terminal exhausted state

### Requirement: A validated, imported download fulfils the acquisition
The system SHALL mark an acquisition as fulfilled once a candidate has passed validation and been imported into the library.

#### Scenario: Successful acquisition
- **GIVEN** an acquisition whose selected candidate passed validation
- **WHEN** the candidate is imported into the library
- **THEN** the acquisition reaches a terminal fulfilled state recording the library location

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

### Requirement: Processing survives restarts without duplicating effects
The system SHALL resume in-progress acquisitions after a process restart without starting a second download for a candidate that is already in flight. Within the at-least-once crash window — an effect was dispatched and its follow-on outcome recorded, but the consumer's checkpoint was not yet saved — redelivery SHALL converge: a re-dispatched effect is idempotent or its stale outcome is ignored by the decision logic, the acquisition's recorded history gains no duplicate outcome, and redelivery SHALL NOT wedge processing. A follow-on command rejected by the decision logic as stale or illegal SHALL be recorded and skipped (the checkpoint advances past it); only infrastructure faults SHALL leave the checkpoint unadvanced for retry.

#### Scenario: Restart mid-download
- **GIVEN** an acquisition whose candidate download was dispatched before the process restarted
- **WHEN** the process restarts and resumes from its checkpoint
- **THEN** the candidate is not downloaded a second time

#### Scenario: Restart inside the crash window re-dispatches without duplicating outcomes
- **GIVEN** an acquisition whose effect was dispatched and whose follow-on outcome was recorded, but whose consumer checkpoint was not saved before a crash
- **WHEN** the process restarts and redelivers the already-reacted event
- **THEN** the re-dispatched effect converges — the stale follow-on outcome is ignored and the acquisition's recorded history is unchanged

#### Scenario: A stale re-dispatched outcome does not wedge the consumer
- **GIVEN** a redelivered event whose re-dispatched effect produces a follow-on command that the decision logic rejects
- **WHEN** the consumer handles the rejection
- **THEN** it records the rejection, advances its checkpoint past the event, and continues with subsequent events

#### Scenario: An infrastructure fault is retried, not skipped
- **GIVEN** an event whose effect dispatch fails with an infrastructure fault
- **WHEN** the consumer handles the failure
- **THEN** the checkpoint is not advanced and the event is processed again on the next catch-up

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

