## MODIFIED Requirements

### Requirement: Beets is driven through a stateless two-verb bridge behind a port

Adopted from the music-importer repo (capability of the importer module). The system SHALL drive beets exclusively through a stateless Python bridge CLI behind an outbound port: `propose` runs beets' matcher over a directory and emits candidates as JSON — each identified by its `(data_source, album_id)` pair and carrying overall distance, per-penalty breakdown, and track mapping — and `apply` performs the import for a chosen candidate by deterministic ID lookup (or as-is, or with supplied tags), firing beets' full pipeline. The bridge SHALL hold no state between invocations; the JSON boundary SHALL be schema-validated at the port and covered by contract tests over recorded bridge output; the beets version SHALL be pinned in the runtime image. The bridge SHALL reserve its output channel exclusively for the contract JSON: anything beets, its plugins, or their subprocesses print SHALL be diverted to the diagnostic stream and SHALL NOT corrupt the JSON boundary.

`propose` SHALL additionally emit, for each candidate, the field-level differences beets already computes so a review can show what actually differs rather than only how much: for each mapped track, the staged file's current tags (title, artist, track number, length) beside the candidate's proposed tags, and that track's individual distance; the downloaded files that matched no candidate track; the candidate tracks that no file matched; and the candidate's album-level fields (at least year, media, label, catalog number, country, and disambiguation). These fields SHALL be additive to the existing JSON contract — the distance and per-penalty breakdown are unchanged — and SHALL be captured by the recorded contract fixture.

#### Scenario: Propose then apply across separate invocations

- **GIVEN** a proposal produced earlier whose chosen candidate is identified by source and album ID
- **WHEN** apply runs in a fresh invocation, possibly much later
- **THEN** the candidate is re-resolved by direct ID lookup and the import applies with current metadata

#### Scenario: Contract drift is caught at the boundary

- **GIVEN** a bridge whose output no longer matches the recorded contract (e.g., after a beets upgrade)
- **WHEN** the port validates the payload
- **THEN** the mismatch surfaces as an infrastructure error, never as silent misbehavior

#### Scenario: Plugin output cannot corrupt the contract channel

- **GIVEN** a user config whose plugin chain prints freely during load, migration, or import
- **WHEN** any bridge verb runs
- **THEN** the verb's JSON output parses cleanly and the printed noise is available on the diagnostic stream
- **AND** a successful apply is recorded as successful

#### Scenario: Propose carries the concrete differences behind the distance

- **GIVEN** a directory whose best candidate retags a track, leaves one downloaded file unmatched, and expects one track no file supplies
- **WHEN** `propose` emits its JSON
- **THEN** the candidate carries, for each mapped track, the file's current tags beside the proposed tags and that track's distance
- **AND** it carries the unmatched downloaded file, the missing candidate track, and the candidate's album-level fields
- **AND** the overall distance and per-penalty breakdown are still present
