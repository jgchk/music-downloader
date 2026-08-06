# import-management — delta for e2e-review-resolution-loop

## MODIFIED Requirements

### Requirement: A fulfilled acquisition submits an import idempotently through the native path

The system SHALL translate each `acquisition.fulfilled` event consumed from the downloader module's stream (via the cross-module subscription seam) into the same native submission the manual path uses: the sender-namespaced `location` re-rooted from the configured source root (`INTAKE_SOURCE_ROOT`) onto the intake root, with the event's MusicBrainz release id (when present) passed as the pinning hint and the target's artist/title as auxiliary hints. The event SHALL be read tolerantly through the importer's own consumer-owned schema and translated through an anti-corruption layer into the native command. The acquisition id SHALL be recorded on the resulting `ImportRequested` event, together with the delivered candidate's identity when the event carries one — read tolerantly, so a delivery without a usable candidate still submits normally and simply yields an import that cannot emit a release verdict.

Convergence SHALL key on the delivery's position in the seam feed, recorded on each seam-driven cycle and folded into a stream-level watermark (the highest position any cycle ever recorded, surviving manual resubmissions of the same directory): a delivery at or before the watermark is a redelivery and SHALL converge as an acknowledged no-op — durably, across restarts, so a full feed replay creates no duplicate import — while a delivery past the watermark is a genuinely new delivery (the revival loop's replacement after a rejected delivery) and SHALL submit a fresh import cycle. A new delivery that arrives while the stream's current cycle has not yet settled SHALL be held as a retryable failure (never acknowledged), so redelivery lands it once the cycle settles; the domain decider SHALL itself refuse (as a modeled error) a new delivery against an in-flight cycle and converge stale positions on settled terminals, so no caller can duplicate or drop a delivery around the consumer. For a stream whose seam-sourced history predates the watermark the consumer SHALL converge deliveries as before — announcing the convergence in an operator-visible log naming the acquisition and the remediation, since it is the one path that can drop a genuine replacement.

An event whose location falls outside the source root SHALL be rejected; an event whose re-rooted directory does not exist SHALL surface as a retryable failure (never a silent acknowledgement), so the seam's at-least-once redelivery retries it once the files are visible.

#### Scenario: A fulfilled download flows into the import lifecycle

- **GIVEN** the downloader module has recorded `acquisition.fulfilled` for a release visible under the intake root
- **WHEN** the importer's subscription consumes the event
- **THEN** an import is submitted for the re-rooted directory with the event's MusicBrainz release id as the search hint
- **AND** the import proceeds through the normal propose → auto-apply/review lifecycle

#### Scenario: The delivered candidate's identity is retained

- **GIVEN** an `acquisition.fulfilled` event whose payload carries the winning candidate's identity
- **WHEN** the import is submitted
- **THEN** the candidate identity is recorded beside the acquisition id, available to a later release verdict

#### Scenario: A candidate-less delivery still imports

- **GIVEN** an event whose payload lacks a readable candidate
- **WHEN** the import is submitted
- **THEN** submission proceeds normally without a retained candidate

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
