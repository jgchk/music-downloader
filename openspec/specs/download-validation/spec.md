# download-validation Specification

## Purpose

Define how a downloaded release is validated for playability (full decode) and structural identity (track count and per-track durations) against the target, how validators combine into a single confidence verdict, and how that verdict is judged against the acquisition's match policy.

## Requirements

### Requirement: Downloaded audio is checked for playability
The system SHALL verify that each downloaded audio file decodes fully — not merely that its headers parse — so that truncated or corrupt transfers are detected regardless of audio format.

#### Scenario: Truncated file is unplayable
- **GIVEN** a downloaded file whose audio data is truncated
- **WHEN** playability is checked
- **THEN** the file is judged unplayable and validation fails with an unplayable reason

#### Scenario: Formats other than FLAC are supported
- **GIVEN** a downloaded file in a non-FLAC format such as MP3, Opus, or Ogg Vorbis
- **WHEN** playability is checked
- **THEN** the file is decoded and judged on the same basis as a FLAC file

### Requirement: Downloaded audio is checked for structural identity
The system SHALL confirm that the download's track count and per-track durations align with the target within tolerance, using durations measured from the decoded audio rather than reported metadata.

#### Scenario: Wrong track count fails
- **GIVEN** a target with 12 tracks
- **WHEN** the download contains 9 audio tracks
- **THEN** validation fails with a wrong-track-count reason

#### Scenario: Duration mismatch fails
- **GIVEN** a download whose track count matches the target
- **WHEN** one or more track durations fall outside tolerance of the target
- **THEN** validation fails with a duration-mismatch reason

### Requirement: Validators combine into a single confidence verdict
The system SHALL run its validators as a pipeline that produces one combined verdict carrying a confidence score and any failure reasons, and SHALL allow further validators to be added without changing the acquisition logic that consumes the verdict.

#### Scenario: Combined verdict is produced
- **GIVEN** a download and a target
- **WHEN** the validator pipeline runs
- **THEN** a single verdict with a confidence score and reasons is produced

### Requirement: Validation passes only when confidence meets policy
The system SHALL treat a download as valid only when the verdict's confidence meets or exceeds the acquisition's match policy threshold; otherwise the download is rejected.

#### Scenario: Confidence clears a lenient policy
- **GIVEN** a lenient match policy
- **WHEN** the verdict confidence meets the policy threshold
- **THEN** the download passes validation and proceeds to import

#### Scenario: Confidence below policy is rejected
- **GIVEN** a strict match policy
- **WHEN** the verdict confidence is below the policy threshold
- **THEN** the download fails validation and the candidate is rejected
