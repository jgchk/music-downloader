# download-lifecycle Specification

## Purpose

Govern the autonomous lifecycle of a download (the aggregate is a download; "acquisition" survives only in frozen wire and storage names — `acquisition.fulfilled`, `acquisitionId`, the stored event tokens — see `CONTEXT-MAP.md`): from accepting a download request, through the strictly sequential next-best-candidate walk over ranked candidates, bounded re-search, and terminal outcomes (fulfilled, exhausted, cancelled). Ensures processing is durable across restarts and rejects stale external outcomes.
## Requirements
### Requirement: Submitting a download request starts a download
The system SHALL accept a musical request together with optional quality, match, retry, and download policies, and SHALL begin an autonomous download that runs to a terminal outcome without further user interaction.

#### Scenario: A new request is accepted
- **GIVEN** a caller who wants a specific album
- **WHEN** they submit the request with a quality policy
- **THEN** the system creates a download in a pending state and returns its identifier
- **AND** unspecified policies fall back to configured defaults

### Requirement: Candidates are attempted one at a time
The system SHALL run at most one try at a time for a given download, in ranked order, so that the next-best-candidate walk is strictly sequential.

#### Scenario: Only one download is in flight
- **GIVEN** a download with a ranked list of candidates
- **WHEN** the highest-ranked candidate is selected
- **THEN** no other candidate for that download is downloading concurrently

### Requirement: A failed candidate falls through to the next best
The system SHALL, when a candidate's download or validation fails, reject that candidate and select the next-best remaining candidate, without abandoning the download.

#### Scenario: Download failure advances the walk
- **GIVEN** a download currently attempting candidate A with candidates B and C remaining
- **WHEN** candidate A's download fails
- **THEN** candidate A is rejected and candidate B is selected next

#### Scenario: Validation failure advances the walk
- **GIVEN** a download whose downloaded candidate A fails validation
- **WHEN** the validation verdict is recorded
- **THEN** candidate A is rejected and the next-best candidate is selected

### Requirement: Exhausting the working set triggers a bounded re-search
The system SHALL, when no candidates remain and the retry policy budget is not spent, request a fresh search round and merge newly-found candidates with any untried ones, excluding previously-rejected candidates.

#### Scenario: Re-search rescues a download
- **GIVEN** a download whose ranked candidates have all been rejected and a retry budget that is not spent
- **WHEN** the working set becomes empty
- **THEN** the system requests a new search round rather than giving up
- **AND** candidates already rejected are not attempted again

### Requirement: A download is exhausted when options and budget run out

The system SHALL mark a download as exhausted when the total-try budget is consumed (regardless of any candidates remaining in the working set), or when the working set is empty and no search rounds remain. A search round that yields no usable candidates SHALL NOT by itself exhaust the download while search rounds remain: it spends its round and triggers a fresh search round, including when it is the first round.

#### Scenario: An empty first round triggers a re-search, not exhaustion

- **GIVEN** a newly-started download whose first search round yields zero usable candidates and a retry policy with rounds remaining
- **WHEN** the round's results are recorded
- **THEN** the system requests a fresh search round rather than exhausting the download

#### Scenario: Search-round budget spent on empty rounds

- **GIVEN** a download whose every search round up to the retry policy's maximum has yielded no usable candidates
- **WHEN** the final round's empty results are recorded
- **THEN** the download reaches a terminal exhausted state

#### Scenario: Retry budget spent

- **GIVEN** a download that has reached its maximum search rounds
- **WHEN** the working set empties again
- **THEN** the download reaches a terminal exhausted state

### Requirement: A validated, imported download fulfils the download
The system SHALL mark a download as fulfilled once a candidate has passed validation and been imported into the library. Fulfilment SHALL be stable but defeasible: it is the download's resting state and terminal for every existing purpose, but an external validation failure reported for the fulfilled candidate SHALL reject that candidate and revive the download into the existing retry ladder — selecting the next-best candidate, re-searching within bounds, or exhausting — spending the same try and search-round budgets as any other rejection, so total activity remains bounded and the download still converges to an absorbing outcome. A download that never receives such a report SHALL rest at fulfilled indefinitely. All other terminal states remain absorbing.

#### Scenario: Successful download
- **GIVEN** a download whose selected candidate passed validation
- **WHEN** the candidate is imported into the library
- **THEN** the download reaches a terminal fulfilled state recording the library location

#### Scenario: An external rejection revives the ladder
- **GIVEN** a fulfilled download whose working set still holds a next-best candidate
- **WHEN** an external validation failure is reported for the fulfilled candidate
- **THEN** the fulfilled candidate is rejected and the next-best candidate is selected for download
- **AND** the rejection is recorded in the download's history with its reasons

#### Scenario: A revival can exhaust
- **GIVEN** a fulfilled download with no remaining candidates and no search budget
- **WHEN** an external validation failure is reported for the fulfilled candidate
- **THEN** the download reaches the absorbing exhausted state

#### Scenario: A mismatched or repeated verdict is ignored
- **GIVEN** a fulfilled download
- **WHEN** an external validation failure names a candidate other than the fulfilled one, or arrives again after a revival already occurred
- **THEN** the report is ignored and the download's state is unchanged

#### Scenario: Absorbing states cannot be revived
- **GIVEN** an exhausted, cancelled, conflicted, or metadata-failed download
- **WHEN** an external validation failure is reported
- **THEN** the report is ignored

### Requirement: A download can be cancelled

The system SHALL allow a non-terminal download to be cancelled, after which it performs no
further searches, downloads, or imports. Cancelling a download whose candidate transfer is
in flight SHALL abort that transfer at the source promptly — without waiting for the transfer to
settle on its own; the download SHALL remember the pending candidate until its transfer
settles so the settlement can be cleaned up.

#### Scenario: Cancelling in flight

- **GIVEN** a download that is currently downloading
- **WHEN** the caller cancels it
- **THEN** the download reaches a terminal cancelled state and no further work is performed

#### Scenario: Cancelling aborts the in-flight transfer at the source

- **GIVEN** a download that is currently downloading
- **WHEN** the caller cancels it
- **THEN** the in-flight transfers are cancelled at the source rather than left to run to
  completion

#### Scenario: Cancellation is not delayed by the transfer it aborts

- **GIVEN** a download whose download would take an hour to settle at the peer's pace
- **WHEN** the caller cancels it
- **THEN** the abort reaches the source promptly, not after the transfer settles on its own

### Requirement: Processing survives restarts without duplicating effects

The system SHALL resume in-progress downloads after a process restart: for every non-terminal download, the effect its current state is waiting on SHALL be re-derived and re-dispatched idempotently — a mid-flight download re-attaches to its existing transfer where the source still holds it (re-enqueueing otherwise) with its stall and queue-wait budgets restarted, a pending resolution re-fires, and a download awaiting manual selection correctly re-derives no effect. Resumption SHALL NOT start a second download for a candidate whose transfer is already in flight at the source. Within the at-least-once crash window — an effect was dispatched and its follow-on outcome recorded, but the consumer's checkpoint was not yet saved — redelivery SHALL converge: a re-dispatched effect is idempotent or its stale outcome is ignored by the decision logic, the download's recorded history gains no duplicate outcome, and redelivery SHALL NOT wedge processing. A follow-on command rejected by the decision logic as stale or illegal SHALL be recorded and skipped.

#### Scenario: Restart mid-download resumes the transfer

- **GIVEN** a download whose candidate download was dispatched before the process restarted
- **WHEN** the process restarts
- **THEN** the download is driven again — re-attached to the source's existing transfer or re-enqueued — and its stall and queue-wait budgets apply from resumption
- **AND** the candidate is not downloaded a second time when its transfer is already in flight

#### Scenario: Restart mid-resolution re-fires resolution

- **GIVEN** a download that was resolving metadata when the process restarted
- **WHEN** the process restarts
- **THEN** the resolution effect is re-dispatched and the download proceeds on its outcome

#### Scenario: Restart while awaiting manual selection stays paused

- **GIVEN** a download awaiting manual edition selection when the process restarted
- **WHEN** the process restarts
- **THEN** the download remains awaiting selection with its candidates intact and no effect is dispatched for it

#### Scenario: Restart inside the crash window re-dispatches without duplicating outcomes

- **GIVEN** a download whose effect was dispatched and whose follow-on outcome was recorded, but whose consumer checkpoint was not saved before a crash
- **WHEN** the process restarts and redelivers the already-reacted event
- **THEN** the re-dispatched effect converges — the stale follow-on outcome is ignored and the download's recorded history is unchanged

#### Scenario: A stale re-dispatched outcome does not wedge the consumer

- **GIVEN** a redelivered event whose re-dispatched effect produces a follow-on command that the decision logic rejects
- **WHEN** the consumer handles the rejection
- **THEN** it records the rejection and continues with subsequent events

### Requirement: A failing effect stalls only its own download, within a bounded retry budget

The system SHALL isolate effect-dispatch failures per download: an infrastructure fault retrying one download's effect SHALL NOT delay the processing of any other download's events. Retries SHALL back off exponentially and SHALL be bounded by a configurable budget. When the budget is exhausted, the system SHALL land the failure somewhere modeled and visible: an effect whose permanent failure has a modeled business outcome SHALL degrade to that outcome through the normal decision path; an effect without one SHALL be dead-lettered with its full context, and the owning download SHALL be exposed as stalled by the status read model. Every park, retry, degradation, and dead-letter transition SHALL be observably logged with the download, effect, and attempt. Ordering within a download SHALL be preserved while it is parked: its later events wait behind the parked effect; other downloads' events do not.

#### Scenario: Other downloads flow past a poisoned effect

- **GIVEN** one download whose resolution effect fails on every attempt
- **WHEN** another download is submitted and processed
- **THEN** the second download proceeds to its own outcome while the first retries independently

#### Scenario: An exhausted retry budget degrades to the modeled failure

- **GIVEN** a download whose resolution effect has failed for the entire retry budget
- **WHEN** the final retry fails
- **THEN** the download terminates through the modeled metadata-failure path, visibly, and retries stop

#### Scenario: An effect with no modeled failure dead-letters visibly

- **GIVEN** a download whose staging-cleanup effect has failed for the entire retry budget
- **WHEN** the final retry fails
- **THEN** the effect is dead-lettered with its context and the download is exposed as stalled by the status read model

#### Scenario: A transient outage rides out the backoff

- **GIVEN** an effect failing because its upstream is briefly unavailable
- **WHEN** the upstream recovers within the retry budget
- **THEN** a backed-off retry succeeds and the download proceeds normally

### Requirement: Startup catch-up work does not block readiness

The system SHALL report the download runtime ready once its stores, subscriptions, and schedulers are wired; the startup catch-up drain and the re-derivation pass SHALL execute in the background after readiness. A backlog of pending effect work SHALL NOT delay the runtime's readiness, and the work SHALL still be driven to completion with the same ordering guarantees as live processing.

#### Scenario: A heavy backlog does not delay readiness

- **GIVEN** a restart with pending effect work in the backlog (for example an in-flight download)
- **WHEN** the runtime boots
- **THEN** the runtime reports ready without waiting for the backlog's effects to execute
- **AND** the backlog is subsequently driven to completion in the background

### Requirement: Stale external outcomes are ignored
The system SHALL reject an external outcome (such as a late download result) that does not correspond to the download's current state — except that a download settlement arriving for a cancelled download's still-pending candidate SHALL reject that candidate (triggering its staging cleanup) while the download remains cancelled; any further settlement reports for that candidate are then ignored.

#### Scenario: Settlement after cancellation rejects the pending candidate
- **GIVEN** a download cancelled while its candidate's transfer was in flight
- **WHEN** the transfer's settlement (completed or failed) is reported afterwards
- **THEN** the pending candidate is rejected, its staged files become eligible for cleanup, and the download remains cancelled

#### Scenario: Duplicate settlement after cleanup is ignored
- **GIVEN** a cancelled download whose pending candidate has already been rejected
- **WHEN** another settlement report arrives for that candidate
- **THEN** the report is ignored and the download remains cancelled


### Requirement: A download awaiting edition selection pauses until a choice is made

The system SHALL, when metadata resolution yields a manual-selection outcome (a release-group request whose group has no official edition), pause the download in an awaiting-selection state that retains the candidate editions, rather than searching or failing. While awaiting selection the download SHALL perform no search, download, or import. The system SHALL resume the download only on an explicit edition selection or a cancellation. On selection of a candidate edition, the system SHALL resolve that edition into the canonical target — identical to resolving the chosen release by its identifier — and continue the normal download flow. Selection SHALL be accepted only while the download is awaiting selection; a selection naming an edition that is not among the retained candidates, or arriving in any other state, SHALL be rejected as a modeled error without altering the download.

#### Scenario: A group with no official edition pauses for selection

- **GIVEN** a download whose release-group request resolves to a group with candidate editions but no official edition
- **WHEN** metadata resolution completes
- **THEN** the download enters the awaiting-selection state retaining the candidate editions
- **AND** no search, download, or import is performed while it waits

#### Scenario: Selecting an edition resumes the download

- **GIVEN** a download awaiting edition selection
- **WHEN** a caller selects one of the retained candidate editions
- **THEN** the system resolves that edition into the canonical target and the download proceeds to search as if the target had been resolved directly

#### Scenario: An unknown or out-of-state selection is rejected

- **GIVEN** a download that is awaiting edition selection
- **WHEN** a selection names an edition that is not among the retained candidates
- **THEN** the system rejects the selection as a modeled error and the download remains awaiting selection
- **AND** a selection submitted for a download that is not awaiting selection is likewise rejected without effect

#### Scenario: Cancelling while awaiting selection ends the download

- **GIVEN** a download awaiting edition selection
- **WHEN** the download is cancelled
- **THEN** the download terminates through the normal cancellation path without selecting an edition

### Requirement: Download history entries carry their occurrence time

Each entry of the download status read model's history SHALL carry the occurrence time of the
event it projects, sourced from the timestamp already stamped on that stored event, so a consumer
can order the download's history against another context's history in real time.

#### Scenario: Each history entry reports when it happened

- **WHEN** a download's status is read
- **THEN** every history entry carries the ISO-8601 occurrence time of its underlying event


### Requirement: The download status read model exposes decided lifecycle flags

The download status read model SHALL expose the download's own decided lifecycle facts as fields on the status view, so a consumer renders them rather than re-deriving them from the status enum. It SHALL expose whether the download is **cancellable** — true exactly when a cancellation would still do something, which is the same condition the cancel decision uses (a non-terminal download), and false for every terminal download — and whether the download is **awaiting selection** — true exactly when it is paused for a human's edition choice. Both flags SHALL be additive on the status contract (absent-tolerant), and SHALL be the download's own determination, not a value a consumer computes from the phase name.

#### Scenario: A non-terminal download reports itself cancellable

- **GIVEN** a download that has not reached a terminal state
- **WHEN** its status view is read
- **THEN** the view reports it as cancellable

#### Scenario: A terminal download reports itself not cancellable

- **GIVEN** a download that has reached a terminal state (fulfilled, exhausted, cancelled, metadata-failed, or conflicted)
- **WHEN** its status view is read
- **THEN** the view reports it as not cancellable

#### Scenario: An awaiting-selection download reports itself awaiting a human

- **GIVEN** a download paused for a manual edition choice
- **WHEN** its status view is read
- **THEN** the view reports it as awaiting selection, while a download in any other phase reports it as not awaiting selection

### Requirement: The status view states when the download was requested

The download status read model SHALL expose **when the download was requested** (`requestedAt`) as a field on the status view, taken from the recorded request event itself and NOT from the position an event happens to hold in storage, so a consumer ordering or describing downloads by recency reads a stated fact rather than one derived from storage or replay order. The field SHALL be present on the status view of every download whose stream records a request — which is every download the downloader produces — and SHALL be additive on the status contract (absent-tolerant for existing consumers), like the other decided lifecycle facts the view carries. Where a stream records no request at all, the view SHALL state no requested-at time rather than reporting some other event's.

#### Scenario: A fresh request states its requested-at time

- **WHEN** a download is requested and its status view is read
- **THEN** the view's requested-at fact equals the time the request was recorded

#### Scenario: Requested-at is stable across the lifecycle

- **WHEN** a download progresses through later phases and its status view is read again
- **THEN** the requested-at fact still reports the original request time, unchanged by subsequent events

#### Scenario: The stamp follows the request event, not the stored order

- **WHEN** a status view is read for a stream whose earliest stored event is something other than the request
- **THEN** the requested-at fact reports the request event's own time, not that of the event stored first

### Requirement: Download history covers the full lifecycle

The download status read model's history SHALL cover the download's whole story as curated
milestones, not only attempt-level steps. In addition to the existing entry kinds (`selected`,
`download-failed`, `validation-failed`, `imported`, `fulfillment-rejected`), the history SHALL
surface: the request itself (`requested`, carrying the request target as given — MusicBrainz id,
release-group id, or artist/title descriptor), metadata resolution (`resolved`, carrying the
resolved artist and title, and year where present), each search round (`search-started`, carrying
the round number), and every terminal outcome (`fulfilled` with its location, `exhausted`,
`conflicted` with the conflicting location, `metadata-failed`, `cancelled`). These SHALL be
additive facade schema members; existing consumers remain valid tolerant readers.

Curation SHALL remain deliberate: `CandidatesRanked`, `ValidationPassed`, `DownloadCompleted`,
and `CandidateRejected` SHALL NOT surface as history entries — a candidate rejection is implied
by the failure entry that precedes it.

Because history is folded from stored events at read time, downloads recorded before this
change SHALL gain the new entries with no migration.

#### Scenario: A fresh download already has history

- **WHEN** a download's status is read immediately after submission
- **THEN** its history contains a `requested` entry carrying the request target as given

#### Scenario: A failed download's history ends with its terminal outcome

- **WHEN** the status of a download that exhausted its options (or failed resolution, or was
  cancelled, or conflicted on delivery) is read
- **THEN** the final history entry is the matching terminal kind with its carried detail

#### Scenario: Noise events stay internal

- **WHEN** the status of a download that ranked candidates, passed validation, completed a
  download, and rejected a failed candidate is read
- **THEN** the history contains no entries for ranking, validation success, download completion,
  or candidate rejection

#### Scenario: Pre-existing downloads gain the new entries

- **WHEN** the status of a download recorded before this change is read
- **THEN** its history includes the new lifecycle entries folded from its stored events

### Requirement: The download list read model carries the requested target

The download list read model SHALL additively expose the request target as given (MusicBrainz
id, release-group id, or artist/title descriptor) so a consumer can describe a download whose
metadata never resolved by what the user asked for.

#### Scenario: A never-resolved download is describable

- **WHEN** the download list is read and a download's metadata resolution failed before
  producing a resolved target
- **THEN** that download's list entry still carries the request target as given

### Requirement: No download's in-flight work delays another

The system SHALL NOT allow any single download's in-flight work — healthy or failing, however
long it runs — to delay the processing of other downloads' events, effects, or scheduled
retries. This strengthens the existing failure-isolation requirement to cover healthy
long-running work: a download that transfers for an hour holds up nothing but its own
download.

#### Scenario: Acquisitions flow past an hour-long download

- **GIVEN** one download mid-download at a slow peer's pace
- **WHEN** other downloads are submitted and their effects are due
- **THEN** each proceeds through resolution, search, download, and import at its own pace

#### Scenario: Scheduled retries fire while a download is in flight

- **GIVEN** one download mid-download and another download parked on a retryable fault
  whose retry is due
- **WHEN** the retry's due time passes
- **THEN** the parked effect is retried on schedule, not after the download settles

### Requirement: The lifecycle records an honest downloading phase

The system SHALL record, as a fact in the download's history, that a selected candidate's
download started — once the source has accepted the enqueue. The download status read model
SHALL expose a downloading phase while the download is in flight together with the decided
`transferStarted` flag — the download's own determination that the current attempt's transfer
is live, so a consumer reads it rather than re-deriving liveness from the history (the decided
lifecycle-flags rule) — and the history SHALL narrate the start as an additive entry kind
(`download-started`), so a consumer can tell a transferring download from one that merely
selected a candidate. These SHALL be additive facade schema members; existing consumers remain
valid tolerant readers. Live transfer progress remains a read model and SHALL NOT appear in
history (existing requirement, unchanged).

#### Scenario: A transferring download is distinguishable from a selected one

- **GIVEN** a download whose selected candidate's files the source has accepted and begun
  transferring
- **WHEN** its status is read
- **THEN** the status reflects a downloading phase with the decided `transferStarted` flag set,
  and the history contains a `download-started` entry after the selection

#### Scenario: Pre-existing downloads need no migration

- **WHEN** the status of a download recorded before this change is read
- **THEN** its history folds without error, without a `download-started` entry for attempts that
  never recorded one
