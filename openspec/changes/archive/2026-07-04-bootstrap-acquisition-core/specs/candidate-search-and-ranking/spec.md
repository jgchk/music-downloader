## ADDED Requirements

### Requirement: Sources return candidates at the target's granularity
The system SHALL search configured sources for a target and obtain candidates grouped to match the target type — a fileset (folder) for a multi-track release, a single file for a single track — expressed in a source-agnostic shape.

#### Scenario: Album search returns fileset candidates
- **GIVEN** a target that is a multi-track album
- **WHEN** a source is searched
- **THEN** each candidate represents a complete fileset from one source peer

#### Scenario: Single-track search returns file candidates
- **GIVEN** a target that is a single track
- **WHEN** a source is searched
- **THEN** each candidate represents an individual file

### Requirement: Candidates are scored for match confidence against the target
The system SHALL score each candidate's likelihood of being the target using weighted signals, giving greater weight to structural signals (track count, per-track duration alignment) than to name and title similarity.

#### Scenario: Structural agreement raises confidence
- **GIVEN** two candidates for a 12-track target
- **WHEN** one has 12 files with durations matching the target and the other has 9 files
- **THEN** the 12-file candidate receives the higher match confidence

### Requirement: Candidates below the quality floor are excluded
The system SHALL exclude any candidate whose advertised quality is below the quality policy's floor, rather than merely penalizing it.

#### Scenario: Lossy candidate under a lossless floor
- **GIVEN** a quality policy whose floor is lossless
- **WHEN** a candidate advertises a lossy format
- **THEN** that candidate is excluded from the ranking

### Requirement: Candidates below the match threshold are excluded
The system SHALL exclude any candidate whose match confidence is below the match policy's threshold.

#### Scenario: Weak match is excluded
- **GIVEN** a match policy with a confidence threshold
- **WHEN** a candidate scores below that threshold
- **THEN** that candidate is excluded from the ranking

### Requirement: Surviving candidates are ranked lexicographically
The system SHALL rank the candidates that pass both gates by quality bucket first (per the quality policy's order), then by match confidence, then by source reliability.

#### Scenario: Quality wins over a better match
- **GIVEN** two gate-passing candidates, one lossless with lower match confidence and one lossy-but-allowed with higher match confidence
- **WHEN** they are ranked
- **THEN** the lossless candidate ranks higher

#### Scenario: Source reliability breaks a tie
- **GIVEN** two candidates of equal quality bucket and equal match confidence
- **WHEN** they are ranked
- **THEN** the candidate from the faster, more-available source ranks higher

### Requirement: Re-search merges fresh candidates with untried ones
The system SHALL, on a fresh search round, merge newly-found candidates with any untried candidates from prior rounds, exclude previously-rejected candidates by stable identity, and re-rank the union.

#### Scenario: A newly-online peer is incorporated
- **GIVEN** an acquisition that re-searches after exhausting its earlier candidates
- **WHEN** a new candidate is found that was not seen before
- **THEN** it is ranked alongside any untried candidates and the rejected ones are omitted
