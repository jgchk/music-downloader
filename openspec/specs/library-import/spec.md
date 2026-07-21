# library-import Specification

## Purpose

Govern how validated downloads move from staging into the library: gating import on validation, organizing files by the naming policy, working across filesystems, and refusing to overwrite existing releases — and how external validation verdicts for delivered acquisitions arrive back over the cross-module subscription seam.

## Requirements
### Requirement: Only validated downloads enter the library
The system SHALL move files into the library only after they pass validation, keeping downloads in a staging area until then so the library contains only valid music. The system SHALL also discard staged files that will never enter the library — a rejected candidate's files, a conflicted import's files, and the staged files of an acquisition cancelled after its transfer has settled — and SHALL remove a candidate's staging directory once its files have been imported, so the staging area does not accumulate orphaned downloads. When an acquisition is cancelled while a candidate's transfer is still in flight, cleanup SHALL NOT run while the source may still be writing into staging; it SHALL instead be deferred until the transfer settles (the transfer having been aborted at the source), at which point the candidate's staged files are discarded.

#### Scenario: Validated files are imported
- **GIVEN** a download that has passed validation in the staging area
- **WHEN** import runs
- **THEN** the files are placed into the library at their organized location

#### Scenario: Failed downloads are cleaned from staging
- **GIVEN** a candidate whose download or validation failed
- **WHEN** the candidate is rejected
- **THEN** its files are removed from staging and never enter the library

#### Scenario: A conflicted import's files are cleaned from staging
- **GIVEN** a validated download whose import terminated the acquisition with a conflict
- **WHEN** the conflict outcome is processed
- **THEN** the candidate's staged files are removed from staging

#### Scenario: Cancelling after the transfer settled discards staged files
- **GIVEN** an acquisition cancelled while its downloaded files were awaiting validation or import
- **WHEN** the cancellation is processed
- **THEN** the candidate's staged files are removed from staging

#### Scenario: Cancelling during an in-flight transfer defers cleanup until the transfer settles
- **GIVEN** an acquisition cancelled while a candidate's transfer is still in flight
- **WHEN** the cancellation is processed
- **THEN** no staging cleanup is attempted while the transfer is unsettled
- **AND** once the aborted transfer settles, the candidate's staged files are removed from staging

#### Scenario: The staging directory is removed after a successful import
- **GIVEN** a candidate whose files were imported into the library
- **WHEN** the import outcome is processed
- **THEN** the candidate's now-empty staging directory is removed

### Requirement: Imported files are organized by a naming policy
The system SHALL place imported files at a path rendered from the library naming policy and the target's canonical metadata.

#### Scenario: Files land at the policy path
- **GIVEN** a library naming policy and a validated album
- **WHEN** import runs
- **THEN** the files are placed under a path derived from the album's canonical artist, title, and year

### Requirement: Import works across filesystems
The system SHALL move files into the library when staging and the library share a filesystem, and SHALL fall back to a copy-then-remove when they do not.

#### Scenario: Cross-filesystem import
- **GIVEN** a staging area on a different filesystem from the library
- **WHEN** import runs
- **THEN** the files are copied to the library and then removed from staging

### Requirement: Existing library releases are never overwritten
The system SHALL NOT overwrite an existing release in the library; when the target location is already occupied it SHALL report a conflict as the acquisition's terminal outcome.

#### Scenario: Conflict is reported, not clobbered
- **GIVEN** a library that already contains the target release
- **WHEN** import runs for a new acquisition of the same release
- **THEN** the existing files are left untouched and the acquisition terminates reporting a conflict

### Requirement: External verdicts arrive over the cross-module subscription seam
The system SHALL consume external validation verdicts for delivered acquisitions from the importer module's outbound event feed via a durable catch-up subscription: payloads are read tolerantly — only the acquisition id, candidate identity, verdict, and optional reasons this domain needs, ignoring unknown fields — and translated at the boundary into the native external-validation command. Redelivered or stale verdicts SHALL converge without error.

#### Scenario: A rejection verdict revives an acquisition
- **GIVEN** a fulfilled acquisition
- **WHEN** the subscription consumes a verdict event rejecting the fulfilled candidate
- **THEN** the acquisition revives into the retry ladder

#### Scenario: A redelivered verdict converges
- **GIVEN** a verdict event already processed
- **WHEN** the same event is redelivered after a crash before the checkpoint advanced
- **THEN** it is consumed without error and the acquisition's state is unchanged

#### Scenario: Unknown payload fields are ignored
- **GIVEN** a verdict event carrying fields this system does not use
- **WHEN** the event is consumed
- **THEN** the extra fields are ignored and the verdict is handled normally

#### Scenario: A stale verdict converges
- **GIVEN** an acquisition that has already moved past the delivered candidate the verdict concerns
- **WHEN** the verdict event is consumed
- **THEN** the decider converges to a no-op and the subscription's checkpoint advances
