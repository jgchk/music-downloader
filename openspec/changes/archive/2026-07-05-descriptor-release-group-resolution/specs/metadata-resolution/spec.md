# metadata-resolution Delta

## MODIFIED Requirements

### Requirement: A request resolves to a canonical target
The system SHALL resolve a musical request into a canonical target — carrying the normalized artist, title, track list, per-track durations, and release year — via a metadata source, independent of which source is configured. For an album request carrying an artist and title but no identifier, the system SHALL resolve the request's *identity* to a single release group (the album), judging match confidence and ambiguity across release groups rather than across individual releases, and SHALL then select one release (edition) within that group: releases whose title equals the request title after normalization (case, punctuation, and whitespace insensitive; exact equality only, no fuzzy matching) take precedence, ordered by canonical preference — official status first, then earliest release date; when no release title equals the request title, canonical preference alone orders the group. A selected release that cannot yield a valid target SHALL be skipped in favor of the next release in selection order.

#### Scenario: Resolving by metadata identifier
- **GIVEN** a request that carries a MusicBrainz release identifier
- **WHEN** the request is resolved
- **THEN** the system produces a canonical target for exactly that release

#### Scenario: Resolving a popular album by structured descriptor
- **GIVEN** a request carrying an artist and album title for which the metadata source returns many high-scoring releases that are all editions of the same release group
- **WHEN** the request is resolved
- **THEN** the system treats the single release group as an unambiguous identity match and produces a canonical target from one of its releases

#### Scenario: Base title selects the canonical edition
- **GIVEN** a resolved release group containing an original official release and later expanded editions with qualified titles
- **WHEN** the request title equals the group's base title
- **THEN** the system selects the official release with the earliest release date whose title matches the request title

#### Scenario: Edition named in the request text is honored
- **GIVEN** a request title that names a specific edition (e.g. an album title with an edition qualifier) and a resolved release group containing releases with that exact title
- **WHEN** the request is resolved
- **THEN** the system selects a release whose title equals the request title after normalization, not the base edition

#### Scenario: Title matching is exact after normalization
- **GIVEN** a request title that differs from a release title only in letter case, punctuation, or whitespace
- **WHEN** edition selection compares the titles
- **THEN** they are treated as equal
- **AND** a title that names a different or partially-matching edition is not treated as equal

#### Scenario: A release with unusable data is skipped
- **GIVEN** a selection order in which the first release cannot yield a valid target because the metadata source lacks its track data
- **WHEN** the request is resolved
- **THEN** the system falls through to the next release in selection order rather than failing the resolution

### Requirement: Unresolvable requests fail cleanly
The system SHALL, when a request cannot be resolved to a confident match, terminate the acquisition with a metadata-resolution failure that is visible to the caller, rather than proceeding to search. For album requests without an identifier, ambiguity SHALL be judged at the identity (release group) level: multiple high-scoring editions of one release group are not ambiguity, while comparably-scored releases from different release groups are.

#### Scenario: No match found
- **GIVEN** a request for which the metadata source returns no candidates
- **WHEN** the request is resolved
- **THEN** the acquisition terminates with a metadata-resolution failure

#### Scenario: Ambiguous match without an identifier
- **GIVEN** a structured album request for which high-scoring releases from two different release groups score within the ambiguity margin of each other
- **WHEN** the request is resolved
- **THEN** the acquisition terminates with a metadata-resolution failure

#### Scenario: All selectable releases are unusable
- **GIVEN** a resolved release group in which no release in selection order can yield a valid target
- **WHEN** the request is resolved
- **THEN** the acquisition terminates with a metadata-resolution failure
