## MODIFIED Requirements

### Requirement: Only validated downloads enter the library
The system SHALL move files into the library only after they pass validation, keeping downloads in a staging area until then so the library contains only valid music. The system SHALL also discard staged files that will never enter the library — a rejected candidate's files, a conflicted import's files, and the staged files of an acquisition cancelled after its transfer has settled — and SHALL remove a candidate's staging directory once its files have been imported, so the staging area does not accumulate orphaned downloads. Cleanup of a candidate whose transfer is still in flight is explicitly not attempted (the source may still be writing into staging); aborting in-flight transfers on cancellation is deferred to a future change.

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

#### Scenario: Cancelling during an in-flight transfer does not attempt cleanup
- **GIVEN** an acquisition cancelled while a candidate's transfer is still in flight
- **WHEN** the cancellation is processed
- **THEN** no staging cleanup is attempted for that candidate

#### Scenario: The staging directory is removed after a successful import
- **GIVEN** a candidate whose files were imported into the library
- **WHEN** the import outcome is processed
- **THEN** the candidate's now-empty staging directory is removed
