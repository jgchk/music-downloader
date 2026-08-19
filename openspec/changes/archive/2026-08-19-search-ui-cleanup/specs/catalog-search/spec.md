## MODIFIED Requirements

### Requirement: Mixed-entity catalog search

The system SHALL expose a search read that, given a free-text query, returns matching release groups, artists, and recordings from the MusicBrainz catalog in a single response. Each result SHALL carry what the UI needs to present it without further lookups: the MusicBrainz identifier, title or name, artist credit (for release groups and recordings), first-release year and primary/secondary types (for release groups), the artist's type and disambiguation where the catalog states them (for artists), and a representative release identifier (for recordings, when one exists). The search SHALL be performed server-side; the browser SHALL NOT call MusicBrainz directly.

#### Scenario: One query returns all three entity types

- **WHEN** a client searches for a free-text query that matches release groups, artists, and recordings
- **THEN** the response contains a release-group list, an artist list, and a recording list, each entry carrying its identifier and display fields

#### Scenario: Search failure is not zero results

- **WHEN** the upstream catalog cannot be reached or refuses the request
- **THEN** the read returns a modeled failure distinct from an empty result set

#### Scenario: An artist result can say what kind of artist it is

- **WHEN** the catalog states a type (for example Person or Group) for a matched artist that has no disambiguation
- **THEN** the artist entry carries that type, so a client has something truer to show than a placeholder word
