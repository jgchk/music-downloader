## ADDED Requirements

### Requirement: Completed outcomes report the source-reported on-disk location of downloaded files

The system SHALL report each file of a completed download at the location the source itself reports for that file, correlated to the download the system initiated. The reported path MUST reference the real, existing file — it MUST NOT be a location recomputed from candidate identity independently of where the source wrote. When the source reports its location in its own address space (e.g. a container path), the system SHALL map it onto the shared staging volume the system reads from. Staging-cleanup of a rejected candidate SHALL target that same reported location, so its files are actually removed.

#### Scenario: Completed file path reflects where the source wrote it

- **GIVEN** a selected candidate whose files the source writes under a layout the source alone determines (folder naming, sanitization, and collision handling internal to the source)
- **WHEN** the download completes and the system resolves the source's report of each completed file's location, correlated to the download it initiated
- **THEN** each reported file path resolves to the real file the source wrote on the shared staging volume
- **AND** the downstream validation and import steps operate on those existing paths, with no location recomputed to a different scheme

#### Scenario: Source-renamed file is still located

- **GIVEN** a completed download where the source sanitized or de-duplicated the on-disk name so it differs from the requested name
- **WHEN** the system resolves the completed file's location from the source's report
- **THEN** the reported path points at the source's actual on-disk name, not the originally requested name

#### Scenario: Rejected candidate's staged files are cleaned from their real location

- **GIVEN** a candidate whose downloaded files were staged at the source-reported location and then rejected by validation
- **WHEN** staging-cleanup runs for that candidate
- **THEN** it removes the files at that same reported location, leaving no staged residue
