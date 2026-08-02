# acquisition-lifecycle — delta for legible-acquisition-history

## ADDED Requirements

### Requirement: Acquisition history covers the full lifecycle

The acquisition status read model's history SHALL cover the acquisition's whole story as curated
milestones, not only attempt-level steps. In addition to the existing entry kinds (`selected`,
`download-failed`, `validation-failed`, `imported`, `fulfillment-rejected`), the history SHALL
surface: the request itself (`requested`, carrying the request target as given — MusicBrainz id,
release-group id, or artist/title descriptor), metadata resolution (`resolved`, carrying the
resolved artist and title, and year where present), each search round (`search-started`, carrying
the round number), and every terminal outcome (`fulfilled` with its location, `exhausted`,
`conflicted` with the conflicting location, `metadata-failed`, `cancelled`). These SHALL be
additive facade schema members; existing consumers remain valid tolerant readers.

Curation SHALL remain deliberate: `CandidatesRanked`, `ValidationPassed`, `DownloadCompleted`,
and `CandidateRejected` SHALL NOT surface as history entries — a candidate rejection is implied
by the failure entry that precedes it.

Because history is folded from stored events at read time, acquisitions recorded before this
change SHALL gain the new entries with no migration.

#### Scenario: A fresh acquisition already has history

- **WHEN** an acquisition's status is read immediately after submission
- **THEN** its history contains a `requested` entry carrying the request target as given

#### Scenario: A failed acquisition's history ends with its terminal outcome

- **WHEN** the status of an acquisition that exhausted its options (or failed resolution, or was
  cancelled, or conflicted on delivery) is read
- **THEN** the final history entry is the matching terminal kind with its carried detail

#### Scenario: Noise events stay internal

- **WHEN** the status of an acquisition that ranked candidates, passed validation, completed a
  download, and rejected a failed candidate is read
- **THEN** the history contains no entries for ranking, validation success, download completion,
  or candidate rejection

#### Scenario: Pre-existing acquisitions gain the new entries

- **WHEN** the status of an acquisition recorded before this change is read
- **THEN** its history includes the new lifecycle entries folded from its stored events

### Requirement: The acquisition list read model carries the requested target

The acquisition list read model SHALL additively expose the request target as given (MusicBrainz
id, release-group id, or artist/title descriptor) so a consumer can describe an acquisition whose
metadata never resolved by what the user asked for.

#### Scenario: A never-resolved acquisition is describable

- **WHEN** the acquisition list is read and an acquisition's metadata resolution failed before
  producing a resolved target
- **THEN** that acquisition's list entry still carries the request target as given

## MODIFIED Requirements

### Requirement: Acquisition history entries carry their occurrence time

Each entry of the acquisition status read model's history SHALL carry the occurrence time of the
event it projects, sourced from the timestamp already stamped on that stored event, so a consumer
can order the acquisition's history against another context's history in real time.

#### Scenario: Each history entry reports when it happened

- **WHEN** an acquisition's status is read
- **THEN** every history entry carries the ISO-8601 occurrence time of its underlying event
