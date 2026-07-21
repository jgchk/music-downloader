## ADDED Requirements

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
The system SHALL allow a non-terminal acquisition to be cancelled, after which it performs no further searches, downloads, or imports.

#### Scenario: Cancelling in flight
- **GIVEN** an acquisition that is currently downloading
- **WHEN** the caller cancels it
- **THEN** the acquisition reaches a terminal cancelled state and no further work is performed

### Requirement: Processing survives restarts without duplicating effects
The system SHALL resume in-progress acquisitions after a process restart without starting a second download for a candidate that is already in flight.

#### Scenario: Restart mid-download
- **GIVEN** an acquisition whose candidate download was dispatched before the process restarted
- **WHEN** the process restarts and resumes from its checkpoint
- **THEN** the candidate is not downloaded a second time

### Requirement: Stale external outcomes are ignored
The system SHALL reject an external outcome (such as a late download result) that does not correspond to the acquisition's current state.

#### Scenario: Late result after cancellation
- **GIVEN** an acquisition that has been cancelled
- **WHEN** a download-completed result arrives afterwards for that acquisition
- **THEN** the result is ignored and the acquisition remains cancelled
