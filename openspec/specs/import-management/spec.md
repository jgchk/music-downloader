# import-management Specification

## Purpose

Govern the event-sourced import lifecycle of the importer module: submitted directories move through propose, auto-apply or review, to applied or rejected, driven by beets, with fulfilled acquisitions entering idempotently over the cross-module subscription seam. Adopted from the music-importer repo at the modular-monolith merge.

## Requirements
### Requirement: An import is an event-sourced process over a submitted directory

Adopted from the music-importer repo (capability of the importer module). The system SHALL model each import as an event-sourced aggregate keyed by the submitted directory, moving through `requested → proposing → awaiting-review | applying → applied | rejected`, with every transition — including each human resolution and the reason a review was required — recorded as events. The event stream SHALL narrate the import process only: the beets library database remains the system of record for library state, and the system SHALL NOT tag, move, or otherwise mutate library files outside of beets.

#### Scenario: A confident match imports without human action

- **GIVEN** a directory of files whose best candidate scores a strong match
- **WHEN** the import is submitted
- **THEN** the candidate is applied through beets and the import reaches `applied` with no human involvement
- **AND** the event history records the proposal, the winning candidate, and the applied outcome

#### Scenario: History explains a human decision

- **GIVEN** an import that required review and was resolved by choosing a candidate
- **WHEN** the import's history is read
- **THEN** it shows why review was required (the kind and carried detail) and which resolution the user chose

### Requirement: Submission is idempotent and hints aid matching without overriding it

The system SHALL accept an import submission as a directory path plus optional hints (a MusicBrainz release ID, artist/album strings). Resubmitting the same directory while its import is live SHALL NOT create a second import. Hints SHALL pin the candidate search, but match confidence SHALL still govern the verdict: a hinted candidate with a failing distance routes to review carrying the specific mismatch rather than auto-applying.

#### Scenario: A duplicate submission converges

- **GIVEN** a directory already submitted and not yet terminal
- **WHEN** the same directory is submitted again
- **THEN** the existing import is returned and no new aggregate is created

#### Scenario: A hint with a bad distance goes to review, not auto-apply

- **GIVEN** a submission hinted with a MusicBrainz release ID whose files are missing a track
- **WHEN** the proposal completes
- **THEN** the import lands in review with the hinted candidate's penalty detail (the missing track) attached
- **AND** the user may apply it anyway or reject it

### Requirement: A partial apply failure lands applied with remediation, never failed

When beets has moved files into the library but a post-move step (plugin enrichment) fails, the system SHALL record the import as `applied` and raise a remediation review item describing exactly what failed, offering acceptance or a retry of the enrichment. A failure before files move SHALL be retried as an effect failure and, if doomed, land the import `rejected` with its reason.

#### Scenario: Enrichment failure does not mask a successful import

- **GIVEN** an apply where files moved but a network-dependent plugin step failed
- **WHEN** the outcome is recorded
- **THEN** the import is `applied` and a remediation item carries the failed step
- **AND** resolving the item as accepted closes it without touching the library

### Requirement: A fulfilled acquisition submits an import idempotently through the native path

The system SHALL translate each `acquisition.fulfilled` event consumed from the downloader module's stream (via the cross-module subscription seam) into the same native submission the manual path uses: the sender-namespaced `location` re-rooted from the configured source root (`INTAKE_SOURCE_ROOT`) onto the intake root, with the event's MusicBrainz release id (when present) passed as the pinning hint and the target's artist/title as auxiliary hints. The event SHALL be read tolerantly through the importer's own consumer-owned schema and translated through an anti-corruption layer into the native command. The acquisition id SHALL be recorded on the resulting `ImportRequested` event, together with the delivered candidate's identity when the event carries one — read tolerantly, so a delivery without a usable candidate still submits normally and simply yields an import that cannot emit a release verdict. Redelivery of an already-recorded acquisition SHALL converge as an acknowledged no-op — durably, across restarts, without creating a duplicate import. An event whose location falls outside the source root SHALL be rejected; an event whose re-rooted directory does not exist SHALL surface as a retryable failure (never a silent acknowledgement), so the seam's at-least-once redelivery retries it once the files are visible.

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
