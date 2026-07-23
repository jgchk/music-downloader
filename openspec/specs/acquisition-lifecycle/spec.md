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

The system SHALL mark an acquisition as exhausted only when the working set is empty and the retry policy budget is spent — no search rounds remain, or the total-attempt budget is consumed. A search round that yields no usable candidates SHALL NOT by itself exhaust the acquisition while search rounds remain: it spends its round and triggers a fresh search round, including when it is the first round.

#### Scenario: An empty first round triggers a re-search, not exhaustion

- **GIVEN** a newly-started acquisition whose first search round yields zero usable candidates and a retry policy with rounds remaining
- **WHEN** the round's results are recorded
- **THEN** the system requests a fresh search round rather than exhausting the acquisition

#### Scenario: Search-round budget spent on empty rounds

- **GIVEN** an acquisition whose every search round up to the retry policy's maximum has yielded no usable candidates
- **WHEN** the final round's empty results are recorded
- **THEN** the acquisition reaches a terminal exhausted state

#### Scenario: Retry budget spent

- **GIVEN** an acquisition that has reached its maximum search rounds
- **WHEN** the working set empties again
- **THEN** the acquisition reaches a terminal exhausted state

### Requirement: A validated, imported download fulfils the acquisition
The system SHALL mark an acquisition as fulfilled once a candidate has passed validation and been imported into the library. Fulfilment SHALL be stable but defeasible: it is the acquisition's resting state and terminal for every existing purpose, but an external validation failure reported for the fulfilled candidate SHALL reject that candidate and revive the acquisition into the existing retry ladder — selecting the next-best candidate, re-searching within bounds, or exhausting — spending the same attempt and search-round budgets as any other rejection, so total activity remains bounded and the acquisition still converges to an absorbing outcome. An acquisition that never receives such a report SHALL rest at fulfilled indefinitely. All other terminal states remain absorbing.

#### Scenario: Successful acquisition
- **GIVEN** an acquisition whose selected candidate passed validation
- **WHEN** the candidate is imported into the library
- **THEN** the acquisition reaches a terminal fulfilled state recording the library location

#### Scenario: An external rejection revives the ladder
- **GIVEN** a fulfilled acquisition whose working set still holds a next-best candidate
- **WHEN** an external validation failure is reported for the fulfilled candidate
- **THEN** the fulfilled candidate is rejected and the next-best candidate is selected for download
- **AND** the rejection is recorded in the acquisition's history with its reasons

#### Scenario: A revival can exhaust
- **GIVEN** a fulfilled acquisition with no remaining candidates and no search budget
- **WHEN** an external validation failure is reported for the fulfilled candidate
- **THEN** the acquisition reaches the absorbing exhausted state

#### Scenario: A mismatched or repeated verdict is ignored
- **GIVEN** a fulfilled acquisition
- **WHEN** an external validation failure names a candidate other than the fulfilled one, or arrives again after a revival already occurred
- **THEN** the report is ignored and the acquisition's state is unchanged

#### Scenario: Absorbing states cannot be revived
- **GIVEN** an exhausted, cancelled, conflicted, or metadata-failed acquisition
- **WHEN** an external validation failure is reported
- **THEN** the report is ignored

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

The system SHALL resume in-progress acquisitions after a process restart: for every non-terminal acquisition, the effect its current state is waiting on SHALL be re-derived and re-dispatched idempotently — a mid-flight download re-attaches to its existing transfer where the source still holds it (re-enqueueing otherwise) with its stall and queue-wait budgets restarted, a pending resolution re-fires, and an acquisition awaiting manual selection correctly re-derives no effect. Resumption SHALL NOT start a second download for a candidate whose transfer is already in flight at the source. Within the at-least-once crash window — an effect was dispatched and its follow-on outcome recorded, but the consumer's checkpoint was not yet saved — redelivery SHALL converge: a re-dispatched effect is idempotent or its stale outcome is ignored by the decision logic, the acquisition's recorded history gains no duplicate outcome, and redelivery SHALL NOT wedge processing. A follow-on command rejected by the decision logic as stale or illegal SHALL be recorded and skipped.

#### Scenario: Restart mid-download resumes the transfer

- **GIVEN** an acquisition whose candidate download was dispatched before the process restarted
- **WHEN** the process restarts
- **THEN** the download is driven again — re-attached to the source's existing transfer or re-enqueued — and its stall and queue-wait budgets apply from resumption
- **AND** the candidate is not downloaded a second time when its transfer is already in flight

#### Scenario: Restart mid-resolution re-fires resolution

- **GIVEN** an acquisition that was resolving metadata when the process restarted
- **WHEN** the process restarts
- **THEN** the resolution effect is re-dispatched and the acquisition proceeds on its outcome

#### Scenario: Restart while awaiting manual selection stays paused

- **GIVEN** an acquisition awaiting manual edition selection when the process restarted
- **WHEN** the process restarts
- **THEN** the acquisition remains awaiting selection with its candidates intact and no effect is dispatched for it

#### Scenario: Restart inside the crash window re-dispatches without duplicating outcomes

- **GIVEN** an acquisition whose effect was dispatched and whose follow-on outcome was recorded, but whose consumer checkpoint was not saved before a crash
- **WHEN** the process restarts and redelivers the already-reacted event
- **THEN** the re-dispatched effect converges — the stale follow-on outcome is ignored and the acquisition's recorded history is unchanged

#### Scenario: A stale re-dispatched outcome does not wedge the consumer

- **GIVEN** a redelivered event whose re-dispatched effect produces a follow-on command that the decision logic rejects
- **WHEN** the consumer handles the rejection
- **THEN** it records the rejection and continues with subsequent events

### Requirement: A failing effect stalls only its own acquisition, within a bounded retry budget

The system SHALL isolate effect-dispatch failures per acquisition: an infrastructure fault retrying one acquisition's effect SHALL NOT delay the processing of any other acquisition's events. Retries SHALL back off exponentially and SHALL be bounded by a configurable budget. When the budget is exhausted, the system SHALL land the failure somewhere modeled and visible: an effect whose permanent failure has a modeled business outcome SHALL degrade to that outcome through the normal decision path; an effect without one SHALL be dead-lettered with its full context, and the owning acquisition SHALL be exposed as stalled by the status read model. Every park, retry, degradation, and dead-letter transition SHALL be observably logged with the acquisition, effect, and attempt. Ordering within an acquisition SHALL be preserved while it is parked: its later events wait behind the parked effect; other acquisitions' events do not.

#### Scenario: Other acquisitions flow past a poisoned effect

- **GIVEN** one acquisition whose resolution effect fails on every attempt
- **WHEN** another acquisition is submitted and processed
- **THEN** the second acquisition proceeds to its own outcome while the first retries independently

#### Scenario: An exhausted retry budget degrades to the modeled failure

- **GIVEN** an acquisition whose resolution effect has failed for the entire retry budget
- **WHEN** the final retry fails
- **THEN** the acquisition terminates through the modeled metadata-failure path, visibly, and retries stop

#### Scenario: An effect with no modeled failure dead-letters visibly

- **GIVEN** an acquisition whose staging-cleanup effect has failed for the entire retry budget
- **WHEN** the final retry fails
- **THEN** the effect is dead-lettered with its context and the acquisition is exposed as stalled by the status read model

#### Scenario: A transient outage rides out the backoff

- **GIVEN** an effect failing because its upstream is briefly unavailable
- **WHEN** the upstream recovers within the retry budget
- **THEN** a backed-off retry succeeds and the acquisition proceeds normally

### Requirement: Startup catch-up work does not block readiness

The system SHALL report the acquisition runtime ready once its stores, subscriptions, and schedulers are wired; the startup catch-up drain and the re-derivation pass SHALL execute in the background after readiness. A backlog of pending effect work SHALL NOT delay the runtime's readiness, and the work SHALL still be driven to completion with the same ordering guarantees as live processing.

#### Scenario: A heavy backlog does not delay readiness

- **GIVEN** a restart with pending effect work in the backlog (for example an in-flight download)
- **WHEN** the runtime boots
- **THEN** the runtime reports ready without waiting for the backlog's effects to execute
- **AND** the backlog is subsequently driven to completion in the background

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


### Requirement: An acquisition awaiting edition selection pauses until a choice is made

The system SHALL, when metadata resolution yields a manual-selection outcome (a release-group request whose group has no official edition), pause the acquisition in an awaiting-selection state that retains the candidate editions, rather than searching or failing. While awaiting selection the acquisition SHALL perform no search, download, or import. The system SHALL resume the acquisition only on an explicit edition selection or a cancellation. On selection of a candidate edition, the system SHALL resolve that edition into the canonical target — identical to resolving the chosen release by its identifier — and continue the normal acquisition flow. Selection SHALL be accepted only while the acquisition is awaiting selection; a selection naming an edition that is not among the retained candidates, or arriving in any other state, SHALL be rejected as a modeled error without altering the acquisition.

#### Scenario: A group with no official edition pauses for selection

- **GIVEN** an acquisition whose release-group request resolves to a group with candidate editions but no official edition
- **WHEN** metadata resolution completes
- **THEN** the acquisition enters the awaiting-selection state retaining the candidate editions
- **AND** no search, download, or import is performed while it waits

#### Scenario: Selecting an edition resumes the acquisition

- **GIVEN** an acquisition awaiting edition selection
- **WHEN** a caller selects one of the retained candidate editions
- **THEN** the system resolves that edition into the canonical target and the acquisition proceeds to search as if the target had been resolved directly

#### Scenario: An unknown or out-of-state selection is rejected

- **GIVEN** an acquisition that is awaiting edition selection
- **WHEN** a selection names an edition that is not among the retained candidates
- **THEN** the system rejects the selection as a modeled error and the acquisition remains awaiting selection
- **AND** a selection submitted for an acquisition that is not awaiting selection is likewise rejected without effect

#### Scenario: Cancelling while awaiting selection ends the acquisition

- **GIVEN** an acquisition awaiting edition selection
- **WHEN** the acquisition is cancelled
- **THEN** the acquisition terminates through the normal cancellation path without selecting an edition

### Requirement: Acquisition history entries carry their occurrence time

Each entry of the acquisition status read model's history SHALL carry the occurrence time of the event it projects, sourced from the timestamp already stamped on that stored event, so a consumer can order the acquisition's history against another context's history in real time. This is additive to the existing history entries and SHALL NOT change which events surface as history or their carried detail.

#### Scenario: Each history entry reports when it happened

- **WHEN** an acquisition's status is read
- **THEN** every history entry carries the ISO-8601 occurrence time of its underlying event

### Requirement: The acquisition status read model exposes decided lifecycle flags

The acquisition status read model SHALL expose the acquisition's own decided lifecycle facts as fields on the status view, so a consumer renders them rather than re-deriving them from the status enum. It SHALL expose whether the acquisition is **cancellable** — true exactly when a cancellation would still do something, which is the same condition the cancel decision uses (a non-terminal acquisition), and false for every terminal acquisition — and whether the acquisition is **awaiting selection** — true exactly when it is paused for a human's edition choice. Both flags SHALL be additive on the status contract (absent-tolerant), and SHALL be the acquisition's own determination, not a value a consumer computes from the phase name.

#### Scenario: A non-terminal acquisition reports itself cancellable

- **GIVEN** an acquisition that has not reached a terminal state
- **WHEN** its status view is read
- **THEN** the view reports it as cancellable

#### Scenario: A terminal acquisition reports itself not cancellable

- **GIVEN** an acquisition that has reached a terminal state (fulfilled, exhausted, cancelled, metadata-failed, or conflicted)
- **WHEN** its status view is read
- **THEN** the view reports it as not cancellable

#### Scenario: An awaiting-selection acquisition reports itself awaiting a human

- **GIVEN** an acquisition paused for a manual edition choice
- **WHEN** its status view is read
- **THEN** the view reports it as awaiting selection, while an acquisition in any other phase reports it as not awaiting selection
