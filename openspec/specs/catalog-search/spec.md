# catalog-search Specification

## Purpose
The downloader-owned search read used to formulate an acquisition request: mixed-entity MusicBrainz catalog search with server-side relevance ranking and intent ordering, artist discography browse, edition listing grouped by tracklist, per-edition tracklist reads, and a preview of the edition the acquisition pipeline's own picker would select.
## Requirements
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

### Requirement: Relevance ranking owns the artist-field problem

Search results SHALL be ordered by a ranking in which query tokens matched by a result's artist credit count toward relevance, and title tokens the user did not type count against it, so that the canonical release outranks derivative works whose titles merely contain the query. Release groups carrying secondary types (live, remix, compilation, and similar) SHALL rank below an otherwise-equal standard release.

#### Scenario: Artist-plus-album query finds the canonical album

- **WHEN** a user searches an artist name followed by an album title (for example "paul simon graceland")
- **THEN** the release group titled with the album by that artist ranks above releases by other artists whose titles contain the full query (for example a "Paul Simon's Graceland: Solo Marimba" tribute)

#### Scenario: Derivative editions rank below the standard release

- **WHEN** a query matches both a standard studio release group and same-titled live/remix/compilation release groups by the same artist
- **THEN** the standard release group ranks first

### Requirement: A search survives one kind failing

A search asks the catalog about three entity kinds independently, so the system SHALL return the kinds that answered and name the kinds it could not read, rather than discarding a whole answer because one read failed. A search whose every read failed SHALL be reported as a fault.

#### Scenario: One kind unreadable, the rest returned

- **WHEN** the catalog answers for release groups and recordings but the artist read fails
- **THEN** the release groups and recordings are returned, and artists is named as a kind that could not be read — so a client can say why that block is empty rather than showing it as "nothing matched"

#### Scenario: Every kind unreadable is a fault

- **WHEN** all three of a search's reads fail
- **THEN** the search reports an infrastructure fault, not an empty result

### Requirement: Intent ordering of entity blocks

The search response SHALL state which entity type leads: artists when the query exactly matches an artist name, recordings when the best recording match clearly outranks the best album-shaped release-group match, and release groups otherwise (the albums-first default).

#### Scenario: Bare artist name leads with artists

- **WHEN** a user searches exactly an artist's name (for example "paul simon")
- **THEN** the response designates artists as the leading block

#### Scenario: Track-shaped query leads with recordings

- **WHEN** a user searches an artist plus a track title that names no album (for example "paul simon the boy in the bubble")
- **THEN** the response designates recordings as the leading block

#### Scenario: Artist-plus-album query leads with release groups

- **WHEN** a user searches an artist plus an album title (for example "paul simon graceland")
- **THEN** the response designates release groups as the leading block

### Requirement: Direct identifier resolution

Given a MusicBrainz identifier instead of free text, the search read SHALL resolve it to the single matching entity — release group, artist, or recording — and return it as the sole result, or a modeled not-found outcome when the identifier matches none of them.

#### Scenario: Pasted MBID resolves to its entity

- **WHEN** a client submits a well-formed MusicBrainz identifier of a release group
- **THEN** the response contains exactly that release group and no other results

### Requirement: Artist discography browse

The system SHALL expose a read that, given an artist identifier, returns the artist's release groups ordered with albums before other types and newest first within a type.

#### Scenario: Browsing an artist

- **WHEN** a client requests the discography of an artist identifier
- **THEN** the response lists that artist's release groups, albums first, each with title, year, and primary type

### Requirement: Edition listing grouped by tracklist

The system SHALL expose a read that, given a release-group identifier, returns its editions — each with date, country, media formats, status, and total track count where the catalog states one — grouped by track count, so a client can present "which tracklist" as the primary edition choice and individual editions as the secondary one. An edition the catalog states no track count for SHALL carry no count rather than a zero, and SHALL be grouped apart from counted editions and ordered behind them.

#### Scenario: Editions grouped by track count

- **WHEN** a client requests the editions of a release group whose releases have differing track counts
- **THEN** editions are returned grouped by total track count, with each group's edition count derivable and each edition carrying its date, country, formats, and status

#### Scenario: An uncounted edition is never the default

- **WHEN** a release group has one edition the catalog states a track count for and one it does not
- **THEN** the counted edition is the one named as the pipeline's default — an unstated count never wins the choice

### Requirement: Tracklist read

The system SHALL expose a read that, given a release identifier, returns its ordered tracks with titles and durations. This read SHALL be separate from search and edition listing so that clients fetch tracklists on demand rather than for every result.

#### Scenario: Fetching a tracklist on demand

- **WHEN** a client requests the tracklist of a release identifier
- **THEN** the response lists the release's tracks in playing order with title and duration

### Requirement: Best-match edition preview

The edition listing SHALL include which edition the acquisition pipeline's own selection policy would pick for that release group, produced by the same policy the pipeline uses (not a reimplementation that can drift), or an explicit "no automatic pick — selection required" outcome when the policy yields no candidate.

#### Scenario: The default pick is visible before requesting

- **WHEN** a client requests the editions of a release group that has official editions
- **THEN** the response identifies the single edition the pipeline's selection policy would resolve, and that edition appears in the grouped listing

#### Scenario: No official edition means no silent pick

- **WHEN** a client requests the editions of a release group with no official edition
- **THEN** the response states that no automatic pick exists rather than nominating one

### Requirement: Upstream stewardship

Catalog reads SHALL respect the upstream source's client obligations: every request identifies this application to the source; a repeated identical read within a short window is served from a server-side cache rather than re-queried; concurrent identical reads share one upstream request rather than racing; and a search SHALL cost a fixed, small number of upstream requests regardless of how many results it returns — never one per result.

Pacing is deliberately achieved by asking less rather than by queueing: a minimum-interval queue in front of a user-facing search would serialize a search's entity queries into multi-second waits, so the obligation is met by the cache, by sharing in-flight reads, and by the client's own debounce, with tracklists fetched only when a person asks for one.

#### Scenario: Typing does not re-query the upstream

- **WHEN** a user's typing produces repeated searches for the same query within the cache window
- **THEN** at most one upstream query per entity type is made for that query and the rest are served from cache

#### Scenario: Concurrent identical searches share one upstream read

- **WHEN** two searches for the same query are in flight at once
- **THEN** they share a single upstream request per entity type rather than issuing one each

#### Scenario: Result count never multiplies upstream requests

- **WHEN** a search returns many results of every kind
- **THEN** the number of upstream requests it made does not depend on how many results were returned

