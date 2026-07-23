# match-review Specification

## Purpose

Expose uncertain imports as a typed review queue with kind-specific context, resolved through explicit verbs on the importer module's facade — driven by any interface, currently the web UI. Adopted from the music-importer repo at the modular-monolith merge.

## Requirements
### Requirement: Uncertain imports wait in a typed review queue

Adopted from the music-importer repo (capability of the importer module); the queue and its resolutions are exposed through the importer module's facade, driven by any interface — currently the web UI. The system SHALL expose every import awaiting human action as a review item of an explicit kind — `match-review` (weak or hint-contradicted match, carrying the candidate list with distances and per-penalty detail), `no-match` (beets found no candidates), `duplicate-review` (the album already exists in the library), or `remediation-review` (post-move enrichment failed) — with enough carried context to decide without SSH or the beets CLI.

A `match-review` item SHALL additionally carry, for each candidate, the actual field-level differences between the downloaded files and that candidate: per mapped track, the file's current tags beside the candidate's proposed tags and that track's distance; the downloaded files that matched no candidate track; the candidate tracks that no file matched; and the candidate's album-level fields. It SHALL also carry the pinned/hinted release id when one was in play, so a consumer can state truthfully whether the hint was honored: the item SHALL distinguish "the pinned release was not the best match" (the best candidate's release id differs from the pinned id) from "the pinned release matched but confidence was low" (the best candidate is the pinned release), and SHALL claim the hint was contradicted only in the former case. These carried fields are additive; a review recorded before this capability existed SHALL still be readable, carrying the distance and penalty detail without the field-level diff.

#### Scenario: The pending queue is listable with actionable context

- **GIVEN** imports awaiting review of different kinds
- **WHEN** the pending reviews are listed through the facade
- **THEN** each item carries its kind, the submitted directory, and kind-specific context (candidates with distances, the duplicate's incumbent, or the failed enrichment step)

#### Scenario: No-match is distinguished from low confidence

- **GIVEN** a directory for which beets returns zero candidates
- **WHEN** its review item is read
- **THEN** its kind states that no candidates were found, not that confidence was low

#### Scenario: A match-review carries the concrete differences per candidate

- **GIVEN** a match-review whose best candidate retags a track, leaves a downloaded file unmatched, and expects a track no file supplies
- **WHEN** the review item is read
- **THEN** the candidate carries the per-track current-vs-proposed tags, the unmatched file, the missing track, and the candidate's album-level fields, alongside the existing distance and penalties

#### Scenario: A weak match on the pinned release is not reported as contradicted

- **GIVEN** a match-review reached with a pinned release id whose best candidate is that same release, only with low confidence
- **WHEN** the review item is read
- **THEN** it indicates the pinned release matched but confidence was low, not that the hint was contradicted

#### Scenario: A pre-existing review is still readable

- **GIVEN** a match-review recorded before field-level differences were captured
- **WHEN** the review item is read
- **THEN** it carries its distance and penalty detail and omits the field-level diff, without error

### Requirement: Reviews resolve through explicit verbs, and rejection cleans intake

The system SHALL resolve review items through explicit verbs on the importer module's facade: apply a listed candidate, supply a release ID for a pinned re-propose (accepting any identifier a loaded beets source can resolve, not MusicBrainz alone), refresh the candidate list, apply a full manual tag payload (per-track fields with an explicit track mapping; beets applies them with autotagging bypassed, plugins still firing), import as-is, reject, and reject-and-retry-download. Rejecting SHALL delete the release's files from the intake directory. Reject-and-retry-download SHALL do everything reject does and SHALL additionally record a release verdict — the fact that the delivered release failed external validation — carrying the originating acquisition id, the delivered candidate's identity, and the reviewer's reasons; it SHALL be available only for imports that retain a delivered candidate's identity, and SHALL otherwise be refused with an error naming the missing precondition while plain reject remains available. Resolving an already-settled review SHALL be a tolerated no-op.

#### Scenario: Supplying an ID re-proposes pinned to that release

- **GIVEN** a match-review whose candidates are all wrong
- **WHEN** the user supplies a release ID
- **THEN** the system re-proposes pinned to that ID and the review updates with the resulting candidate

#### Scenario: Manual tags import without autotagging

- **GIVEN** a no-match review for a release MusicBrainz will never know
- **WHEN** the user resolves it with a full tag payload
- **THEN** the files import carrying exactly the supplied tags, filed by the library's path rules

#### Scenario: Rejection leaves no residue

- **GIVEN** a review the user rejects outright
- **WHEN** the rejection is recorded
- **THEN** the release's files are removed from intake and the import is terminal `rejected`

#### Scenario: Reject-and-retry-download records the verdict beside the rejection

- **GIVEN** a review for an import that arrived from the downloader with a retained candidate
- **WHEN** the user resolves it with reject-and-retry-download and reasons
- **THEN** the files are removed from intake, the import is terminal `rejected`, and a release verdict is recorded carrying the acquisition id, the retained candidate identity, and the reasons

#### Scenario: The retry verb is refused without a retained candidate

- **GIVEN** a review for a manually submitted import, or one recorded before candidate retention existed
- **WHEN** reject-and-retry-download is attempted
- **THEN** it is refused with an error naming the missing retained candidate
- **AND** plain reject still resolves the review normally

#### Scenario: A redelivered resolution converges

- **GIVEN** a review already resolved
- **WHEN** the same resolution is delivered again
- **THEN** nothing changes and no error is raised
