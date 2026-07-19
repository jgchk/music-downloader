## MODIFIED Requirements

### Requirement: A request resolves to a canonical target

The system SHALL resolve a musical request into a canonical target — carrying the normalized artist, title, track list, per-track durations, and release year — via a metadata source, independent of which source is configured. For an album request carrying an artist and title but no identifier, the system SHALL resolve the request's *identity* to a single release group (the album), judging match confidence and ambiguity across release groups rather than across individual releases; when exactly one high-confidence release group's title equals the request title after normalization (case, punctuation, and whitespace insensitive; exact equality only, no fuzzy matching), that group SHALL be the resolved identity without regard to the scores of groups whose titles do not equal the request. The system SHALL then select one release (edition) within the resolved group: releases whose title equals the request title after normalization take precedence, ordered by canonical preference — official status first, then earliest release date; when no release title equals the request title, canonical preference alone orders the group. A selected release that cannot yield a valid target SHALL be skipped in favor of the next release in selection order.

#### Scenario: Resolving by metadata identifier

- **GIVEN** a request that carries a MusicBrainz release identifier
- **WHEN** the request is resolved
- **THEN** the system produces a canonical target for exactly that release

#### Scenario: Resolving a popular album by structured descriptor

- **GIVEN** a request carrying an artist and album title for which the metadata source returns many high-scoring releases that are all editions of the same release group
- **WHEN** the request is resolved
- **THEN** the system treats the single release group as an unambiguous identity match and produces a canonical target from one of its releases

#### Scenario: A derivative-named sibling group does not block resolution

- **GIVEN** a request whose title equals exactly one high-confidence release group's title after normalization, while sibling groups with derivative titles (e.g. a remix or compilation whose name contains the requested title) score within the ambiguity margin of it
- **WHEN** the request is resolved
- **THEN** the system resolves the identity to the group whose title equals the request

#### Scenario: A request naming the derivative group resolves to it

- **GIVEN** a request whose title equals a remix or otherwise derivative-named release group's title after normalization
- **WHEN** the request is resolved
- **THEN** the system resolves the identity to that derivative group, not to the base album

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

The system SHALL, when a request cannot be resolved to a confident match, terminate the acquisition with a metadata-resolution failure that is visible to the caller, rather than proceeding to search. For album requests without an identifier, ambiguity SHALL be judged at the identity (release group) level: multiple high-scoring editions of one release group are not ambiguity, and comparably-scored sibling groups are not ambiguity when exactly one group's title equals the request title after normalization; comparably-scored groups from different release groups SHALL be ambiguous when none — or more than one — of them bears the requested title.

#### Scenario: No match found

- **GIVEN** a request for which the metadata source returns no candidates
- **WHEN** the request is resolved
- **THEN** the acquisition terminates with a metadata-resolution failure

#### Scenario: Distinct albums genuinely sharing a title fail safe

- **GIVEN** a request whose title equals, after normalization, the titles of two or more comparably high-scoring release groups
- **WHEN** the request is resolved
- **THEN** the acquisition terminates with a metadata-resolution failure rather than guessing between them

#### Scenario: No titled match and close scores remain ambiguous

- **GIVEN** a request whose title equals no high-confidence release group's title after normalization, and whose top two groups score within the ambiguity margin
- **WHEN** the request is resolved
- **THEN** the acquisition terminates with a metadata-resolution failure
