# candidate-search-and-ranking Specification

## Purpose

Define how configured sources are searched for a target, how candidates are scored for match confidence, gated by quality and match policy, ranked lexicographically, and how fresh search rounds merge with untried candidates while excluding rejected ones.

## Requirements

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

### Requirement: A search is harvested only once the source confirms it complete

The system SHALL treat a source search's responses as harvestable only after the source reports the search complete. A search that cannot be confirmed complete within the adapter's polling deadline SHALL surface as a retryable infrastructure fault carrying the last observed search state, never as an empty candidate set. The polling deadline SHALL comfortably exceed the source's own default search duration, so the fault path is the exception rather than the routine outcome.

#### Scenario: Deadline elapses while the search is still in progress

- **GIVEN** a created source search that the source still reports as in progress
- **WHEN** the adapter's polling deadline elapses
- **THEN** the search port yields an infrastructure fault (retryable), not a completed empty result
- **AND** no `SearchCompleted` business fact is recorded from that attempt

#### Scenario: A confirmed-complete search with no responses is a valid empty result

- **GIVEN** a search the source reports complete with zero responses received
- **WHEN** the adapter harvests it
- **THEN** the search port yields an empty candidate set as a valid business outcome

#### Scenario: A create response without a search identifier is a fault

- **GIVEN** a source that acknowledges search creation without returning a search identifier
- **WHEN** the adapter attempts to track the search
- **THEN** the search port yields an infrastructure fault (retryable) — an unidentifiable search can never be polled, harvested, or swept

### Requirement: A harvest contradicted by the source's own bookkeeping is a fault

The system SHALL compare the harvested responses against the response count the source reports for the search; a harvest that returns no responses while the source reports one or more responses received SHALL surface as a retryable infrastructure fault, not as an empty candidate set. When the source does not report a response count, the harvest SHALL be accepted as-is (tolerant reader).

#### Scenario: Source reports responses but the harvest is empty

- **GIVEN** a search the source reports complete with a positive response count
- **WHEN** the responses endpoint yields zero responses
- **THEN** the search port yields an infrastructure fault (retryable), not an empty candidate set

#### Scenario: Absent response count does not block the harvest

- **GIVEN** a search state that omits the response count
- **WHEN** the adapter harvests the completed search
- **THEN** the harvested responses are accepted and mapped to candidates
