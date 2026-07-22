## MODIFIED Requirements

### Requirement: A request resolves to a canonical target

The system SHALL resolve a musical request into a canonical target — carrying the normalized artist, title, track list, per-track durations, and release year — via a metadata source, independent of which source is configured. For an album request carrying an artist and title but no identifier, the system SHALL resolve the request's *identity* to a single release group (the album), judging match confidence and ambiguity across release groups rather than across individual releases; when exactly one high-confidence release group's title equals the request title after normalization (case, punctuation, and whitespace insensitive; exact equality only, no fuzzy matching), that group SHALL be the resolved identity without regard to the scores of groups whose titles do not equal the request. The system SHALL then select one release (edition) within the resolved group: releases whose title equals the request title after normalization take precedence, ordered by canonical preference — official status first, then earliest release date; when no release title equals the request title, canonical preference alone orders the group. When comparing release dates, the system SHALL order chronologically by date components (year, then month, then day), and within the same year a fully-specified date SHALL sort before a less-precise (e.g. year-only) date, so that imprecise dates never displace a precisely-dated edition. A selected release that cannot yield a valid target SHALL be skipped in favor of the next release in selection order.

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

#### Scenario: A precisely-dated edition outranks a year-only edition of the same year

- **GIVEN** two candidate editions of equal precedence on every earlier criterion, one dated with a full year-month-day and one dated with a year only, both in the same year
- **WHEN** edition selection orders them by earliest release date
- **THEN** the fully-specified edition sorts before the year-only edition

## ADDED Requirements

### Requirement: A release-group request resolves to a representative edition

The system SHALL accept a request that names a MusicBrainz release group by identifier and resolve it into a canonical target by selecting one representative **official** edition (release) within that group, without searching or judging cross-group ambiguity (the identity is given). Because a bare release-group identifier expresses no edition-title intent, edition selection SHALL NOT apply the request-title precedence used by the descriptor path. The system SHALL select the edition from among the group's official editions as follows: restrict to those whose total track count equals the modal (most common) track count of the official editions; among those, earliest release date (compared chronologically as in the canonical-target requirement); and break any remaining tie deterministically by stable order. When two track counts are equally common (a modal tie), the system SHALL restrict to the lower track count before applying the remaining criteria. A selected edition that cannot yield a valid target SHALL be skipped in favor of the next edition in selection order.

#### Scenario: Release-group identifier resolves to the canonical standard edition

- **GIVEN** a request naming a release group whose editions include a standard edition (whose track count is the group's most common) and higher-track deluxe or expanded editions
- **WHEN** the request is resolved
- **THEN** the system produces a canonical target from an official, earliest-dated edition whose track count equals the group's modal track count
- **AND** it does not select a deluxe or expanded edition solely because that edition is earlier or higher-scoring

#### Scenario: Modal track count is preferred over an earlier divergent edition

- **GIVEN** a resolved release group in which the earliest official edition has a track count that differs from the group's modal track count
- **WHEN** the request is resolved
- **THEN** the system selects an edition whose track count equals the modal track count, not the earlier divergent edition

#### Scenario: An edition with unusable data is skipped

- **GIVEN** a release-group request whose first selected edition cannot yield a valid target because the metadata source lacks its track data
- **WHEN** the request is resolved
- **THEN** the system falls through to the next edition in selection order rather than failing the resolution

#### Scenario: A release group with no releases fails cleanly

- **GIVEN** a request naming a release group for which the metadata source returns no editions
- **WHEN** the request is resolved
- **THEN** the acquisition terminates with a metadata-resolution failure

### Requirement: A release group with no official edition fails cleanly

The system SHALL, when a release-group request resolves to a group that contains no official edition (whether the group is empty or holds only non-official editions such as bootlegs or promos), terminate the acquisition with a metadata-resolution failure rather than silently selecting a non-official edition. The system SHALL NOT produce a target from a non-official edition for a release-group request.

#### Scenario: A group with only non-official editions fails cleanly

- **GIVEN** a request naming a release group whose editions are all non-official (e.g. bootleg or promotional)
- **WHEN** the request is resolved
- **THEN** the acquisition terminates with a metadata-resolution failure
- **AND** the system does not produce a target from any of the non-official editions
