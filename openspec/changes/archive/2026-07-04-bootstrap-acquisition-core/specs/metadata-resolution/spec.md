## ADDED Requirements

### Requirement: A request resolves to a canonical target
The system SHALL resolve a musical request into a canonical target — carrying the normalized artist, title, track list, per-track durations, and release year — via a metadata source, independent of which source is configured.

#### Scenario: Resolving by metadata identifier
- **GIVEN** a request that carries a MusicBrainz release identifier
- **WHEN** the request is resolved
- **THEN** the system produces a canonical target for that release

#### Scenario: Resolving by structured descriptor
- **GIVEN** a request that carries an artist and album title but no identifier
- **WHEN** the request is resolved
- **THEN** the system selects the best-matching release from the metadata source and produces its canonical target

### Requirement: Unresolvable requests fail cleanly
The system SHALL, when a request cannot be resolved to a confident match, terminate the acquisition with a metadata-resolution failure that is visible to the caller, rather than proceeding to search.

#### Scenario: No match found
- **GIVEN** a request for which the metadata source returns no candidates
- **WHEN** the request is resolved
- **THEN** the acquisition terminates with a metadata-resolution failure

#### Scenario: Ambiguous match without an identifier
- **GIVEN** a structured request for which no candidate is a confident best match
- **WHEN** the request is resolved
- **THEN** the acquisition terminates with a metadata-resolution failure

### Requirement: The target model is source-agnostic
The system SHALL express the resolved target in a normalized model that does not depend on metadata-source-specific fields, so that additional metadata sources can be added without changing downstream matching.

#### Scenario: Downstream matching consumes the normalized target
- **GIVEN** a target produced by the MusicBrainz source
- **WHEN** matching scores a candidate against it
- **THEN** matching reads only normalized target fields, not source-specific ones
