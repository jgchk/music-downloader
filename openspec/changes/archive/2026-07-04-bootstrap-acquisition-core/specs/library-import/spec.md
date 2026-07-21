## ADDED Requirements

### Requirement: Only validated downloads enter the library
The system SHALL move files into the library only after they pass validation, keeping downloads in a staging area until then so the library contains only valid music.

#### Scenario: Validated files are imported
- **GIVEN** a download that has passed validation in the staging area
- **WHEN** import runs
- **THEN** the files are placed into the library at their organized location

#### Scenario: Failed downloads are cleaned from staging
- **GIVEN** a candidate whose download or validation failed
- **WHEN** the candidate is rejected
- **THEN** its files are removed from staging and never enter the library

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
