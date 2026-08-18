# import-management Specification

## Purpose

Govern the event-sourced import lifecycle of the importer module: submitted directories move through propose, auto-apply or review, to applied or rejected, driven by beets, with fulfilled acquisitions entering idempotently over the cross-module subscription seam. Adopted from the music-importer repo at the modular-monolith merge.

## Requirements
### Requirement: An import is an event-sourced process over a submitted directory

Adopted from the music-importer repo (capability of the importer module). The system SHALL model each import as an event-sourced aggregate keyed by the submitted directory, moving through `requested → proposing → awaiting-review | applying → applied | rejected`, with every transition — including each human resolution and the reason a review was required — recorded as events. The event stream SHALL narrate the import process only: the beets library database remains the system of record for library state, and the system SHALL NOT tag, move, or otherwise mutate library files outside of beets.

#### Scenario: A confident match imports without human action

- **GIVEN** a directory of files whose best metadata match scores strongly
- **WHEN** the import is submitted
- **THEN** the match is applied through beets and the import reaches `applied` with no human involvement
- **AND** the event history records the proposal, the selected match, and the applied outcome

#### Scenario: History explains a human decision

- **GIVEN** an import that required review and was resolved by choosing a match
- **WHEN** the import's history is read
- **THEN** it shows why review was required (the kind and carried detail) and which resolution the user chose

### Requirement: Submission is idempotent and hints aid matching without overriding it

The system SHALL accept an import submission as a directory path plus optional hints (a MusicBrainz release ID, artist/album strings). Resubmitting the same directory while its import is live SHALL NOT create a second import. Hints SHALL pin the metadata search, but distance SHALL still govern the verdict: a hinted match with a failing distance routes to review carrying the specific mismatch rather than auto-applying.

#### Scenario: A duplicate submission converges

- **GIVEN** a directory already submitted and not yet terminal
- **WHEN** the same directory is submitted again
- **THEN** the existing import is returned and no new aggregate is created

#### Scenario: A hint with a bad distance goes to review, not auto-apply

- **GIVEN** a submission hinted with a MusicBrainz release ID whose files are missing a track
- **WHEN** the proposal completes
- **THEN** the import lands in review with the hinted match's penalty detail (the missing track) attached
- **AND** the user may apply it anyway or reject it

### Requirement: A partial apply failure lands applied with remediation, never failed

When beets has moved files into the library but a post-move step (plugin enrichment) fails, the system SHALL record the import as `applied` and raise a remediation review item describing exactly what failed, offering acceptance or a retry of the enrichment. A failure before files move SHALL be retried as an effect failure and, if doomed, land the import `rejected` with its reason.

#### Scenario: Enrichment failure does not mask a successful import

- **GIVEN** an apply where files moved but a network-dependent plugin step failed
- **WHEN** the outcome is recorded
- **THEN** the import is `applied` and a remediation item carries the failed step
- **AND** resolving the item as accepted closes it without touching the library

### Requirement: A fulfilled acquisition submits an import idempotently through the native path

The system SHALL translate each `acquisition.fulfilled` event consumed from the downloader module's stream (via the cross-module subscription seam) into the same native submission the manual path uses: the sender-namespaced `location` re-rooted from the configured source root (`INTAKE_SOURCE_ROOT`) onto the intake root, with the event's MusicBrainz release id (when present) passed as the pinning hint and the target's artist/title as auxiliary hints. The event SHALL be read tolerantly through the importer's own consumer-owned schema and translated through an anti-corruption layer into the native command. The acquisition id SHALL be recorded on the resulting `ImportRequested` event, together with the delivered copy's identity when the event carries one — read tolerantly, so a delivery without a usable copy still submits normally and simply yields an import that cannot emit a release verdict.

Convergence SHALL key on the delivery's position in the seam feed, recorded on each seam-driven cycle and folded into a stream-level watermark (the highest position any cycle ever recorded, surviving manual resubmissions of the same directory): a delivery at or before the watermark is a redelivery and SHALL converge as an acknowledged no-op — durably, across restarts, so a full feed replay creates no duplicate import — while a delivery past the watermark is a genuinely new delivery (the revival loop's replacement after a rejected delivery) and SHALL submit a fresh import cycle. A new delivery that arrives while the stream's current cycle has not yet settled SHALL be held as a retryable failure (never acknowledged), so redelivery lands it once the cycle settles; the domain decider SHALL itself refuse (as a modeled error) a new delivery against an in-flight cycle and converge stale positions on settled terminals, so no caller can duplicate or drop a delivery around the consumer. For a stream whose seam-sourced history predates the watermark the consumer SHALL converge deliveries as before — announcing the convergence in an operator-visible log naming the acquisition and the remediation, since it is the one path that can drop a genuine replacement.

An event whose location falls outside the source root SHALL be rejected; an event whose re-rooted directory does not exist SHALL surface as a retryable failure (never a silent acknowledgement), so the seam's at-least-once redelivery retries it once the files are visible.

#### Scenario: A fulfilled download flows into the import lifecycle

- **GIVEN** the downloader module has recorded `acquisition.fulfilled` for a release visible under the intake root
- **WHEN** the importer's subscription consumes the event
- **THEN** an import is submitted for the re-rooted directory with the event's MusicBrainz release id as the search hint
- **AND** the import proceeds through the normal propose → auto-apply/review lifecycle

#### Scenario: The delivered copy's identity is retained

- **GIVEN** an `acquisition.fulfilled` event whose payload carries the delivered copy's identity (the payload's `candidate`)
- **WHEN** the import is submitted
- **THEN** the delivered copy is recorded beside the acquisition id, available to a later release verdict

#### Scenario: A delivery without a copy identity still imports

- **GIVEN** an event whose payload lacks a readable `candidate` (the delivered copy)
- **WHEN** the import is submitted
- **THEN** submission proceeds normally without a retained delivered copy

#### Scenario: Redelivery converges without a duplicate import — even after the import applied

- **GIVEN** an acquisition whose earlier delivery already submitted an import that has since applied (the intake directory is gone)
- **WHEN** the same event is redelivered after a service restart
- **THEN** the delivery is acknowledged as a converged no-op
- **AND** no second import exists

#### Scenario: A replacement delivery after a rejected import starts a fresh cycle

- **GIVEN** an acquisition whose import settled `rejected` via the unusable-delivery verdict, reviving the hunt
- **WHEN** the replacement delivery's `acquisition.fulfilled` event (a later feed position) is consumed
- **THEN** a fresh import cycle is submitted for the re-deposited directory
- **AND** a redelivery of the original delivery still converges as a no-op

#### Scenario: A new delivery holds while the current cycle is unsettled

- **GIVEN** a rejected review whose intake deletion is still owed (the cycle has not settled)
- **WHEN** the replacement delivery arrives
- **THEN** the delivery is held as a retryable failure, not acknowledged
- **AND** redelivery submits it once the cycle settles

#### Scenario: A manual resubmission does not erase the watermark

- **GIVEN** a seam-delivered cycle that was rejected and then manually resubmitted (a cycle with no seam source)
- **WHEN** a later replacement delivery arrives
- **THEN** it still reads as new against the stream's watermark and submits a fresh cycle

#### Scenario: A not-yet-visible directory defers to the seam's redelivery

- **GIVEN** an event whose re-rooted directory does not exist on the filesystem
- **WHEN** the event is processed
- **THEN** it surfaces as a retryable failure so the subscription redelivers it later

### Requirement: An import is retrievable by its originating acquisition id

The importer's reads SHALL expose an import by the acquisition id it was submitted from, returning the same import status view as a lookup by import id, or a modeled not-found when no import exists for that acquisition. The import status view SHALL carry its originating acquisition id when the import arrived from an acquisition, so a consumer holding only an acquisition id can retrieve and identify the corresponding import without knowing the importer's own content-addressed id. This lookup SHALL be served from the reverse index the intake seam already maintains and SHALL NOT require scanning all imports.

#### Scenario: Lookup by acquisition id returns the corresponding import

- **GIVEN** an acquisition that was handed off and submitted as an import
- **WHEN** the import is read by that acquisition id
- **THEN** the same import status view is returned, carrying that acquisition id

#### Scenario: Lookup for an acquisition with no import is a modeled not-found

- **WHEN** an import is read by an acquisition id that has no submitted import
- **THEN** the read returns the modeled not-found value, not an error or a crash

### Requirement: Import history entries carry their occurrence time

Each entry of the import status view's history SHALL carry the occurrence time of the event it projects, sourced from the timestamp already stamped on that stored event, so a consumer can order the import's history against another context's history in real time.

#### Scenario: Each history entry reports when it happened

- **WHEN** an import's history is read
- **THEN** every entry carries the ISO-8601 occurrence time of its underlying event

### Requirement: A failing import effect's retry budget is durable and a spent budget dead-letters visibly

The system SHALL bound retries of an import's failing effect by a configurable budget whose attempt tally is **durable**: the budget SHALL be counted in the module's own store, not in memory, so a process restart resumes the tally rather than resetting it to zero. While an effect fails retryably below its budget the reactor SHALL hold its checkpoint and re-drive the effect (on the fallback poll and after a restart) without advancing past it, so ordering is preserved and no later event leapfrogs the failing one. When the budget is exhausted the system SHALL dead-letter the event with its full effect context — recording the owning import stream — advance past it so one poison effect never wedges the global queue, and expose the owning import as **stalled** by the status read model. A stalled import SHALL be cleared once its stream is driven successfully again. Every retry and dead-letter transition SHALL be observably logged with the import, effect, and attempt.

#### Scenario: A retryable effect failure holds the checkpoint and counts the attempt durably

- **GIVEN** an import whose effect fails with an infrastructure fault below its retry budget
- **WHEN** the reactor processes the event
- **THEN** the checkpoint is not advanced and the attempt is recorded durably in the module's store

#### Scenario: The retry budget survives a restart instead of resetting to zero

- **GIVEN** an import whose effect has failed for part of its retry budget and the process then restarts
- **WHEN** the reactor resumes and re-drives the held event
- **THEN** it continues the attempt tally from where it left off and reaches the budget after the remaining attempts — it does NOT re-retry from a fresh budget on each restart

#### Scenario: An exhausted budget dead-letters and stalls the import visibly

- **GIVEN** an import whose effect fails on every attempt through the entire retry budget
- **WHEN** the final attempt fails
- **THEN** the event is dead-lettered with its effect context and owning import, the checkpoint advances past it, and the import is exposed as stalled by the status read model

#### Scenario: A dead-lettered import is seeded as stalled after a restart

- **GIVEN** a dead letter recorded for a reactor effect before the process restarted
- **WHEN** the runtime boots and seeds the stalled read model from the dead-letter store
- **THEN** the owning import reads as stalled through the facade without waiting for any new event

#### Scenario: A poison effect does not wedge other imports

- **WHEN** one import's effect exhausts its budget and dead-letters
- **THEN** the checkpoint advances past it and subsequent events are processed, rather than the global queue stalling behind the poison effect forever

### Requirement: The import status read model exposes decided settledness

The import status read model SHALL additively expose `settled` — whether the import has reached a
terminal state — decided from the import domain's own terminality, so a consumer never re-derives
"is anything more coming?" by pattern-matching the phase enum (the decided-lifecycle-flags
pattern). A consumer reading an absent flag (an older producer) SHALL be able to degrade
conservatively to unsettled.

#### Scenario: A terminal import reports itself settled

- **WHEN** the status of an applied or rejected import is read
- **THEN** the view carries `settled: true`

#### Scenario: An in-flight import reports itself unsettled

- **WHEN** the status of an import that is proposing, awaiting review, or applying is read
- **THEN** the view carries `settled: false`
