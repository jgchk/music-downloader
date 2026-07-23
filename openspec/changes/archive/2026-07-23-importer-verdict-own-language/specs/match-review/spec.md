## MODIFIED Requirements

### Requirement: Reviews resolve through explicit verbs, and rejection cleans intake

The system SHALL resolve review items through explicit verbs on the importer module's facade: apply a listed candidate, supply a release ID for a pinned re-propose (accepting any identifier a loaded beets source can resolve, not MusicBrainz alone), refresh the candidate list, apply a full manual tag payload (per-track fields with an explicit track mapping; beets applies them with autotagging bypassed, plugins still firing), import as-is, reject, and reject-unusable-delivery. The two reject verbs express the importer's own intent: reject is "wrong thing to have"; reject-unusable-delivery is "right thing, bad copy". Rejecting SHALL delete the release's files from the intake directory. Reject-unusable-delivery SHALL do everything reject does and SHALL additionally record a release verdict — the fact that the delivered copy was rejected as unusable — carrying the originating acquisition id, the delivered candidate's identity, and the reviewer's reasons as opaque provenance the importer echoes back without interpreting; it SHALL be available only for imports that retain a delivered candidate's identity, and SHALL otherwise be refused with an error naming the missing precondition while plain reject remains available. Resolving an already-settled review SHALL be a tolerated no-op. A review recorded under the module's earlier verb name SHALL read, settle, and project identically to one recorded under the current name, so no historical import is broken by the rename.

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

#### Scenario: Reject-unusable-delivery records the verdict beside the rejection

- **GIVEN** a review for an import that arrived from the downloader with a retained candidate
- **WHEN** the user resolves it with reject-unusable-delivery and reasons
- **THEN** the files are removed from intake, the import is terminal `rejected`, and a release verdict is recorded carrying the acquisition id, the retained candidate identity, and the reasons

#### Scenario: The unusable-delivery verb is refused without a retained candidate

- **GIVEN** a review for a manually submitted import, or one recorded before candidate retention existed
- **WHEN** reject-unusable-delivery is attempted
- **THEN** it is refused with an error naming the missing retained candidate
- **AND** plain reject still resolves the review normally

#### Scenario: A redelivered resolution converges

- **GIVEN** a review already resolved
- **WHEN** the same resolution is delivered again
- **THEN** nothing changes and no error is raised

#### Scenario: A legacy-recorded rejection reads under the current verb

- **GIVEN** a `ReviewResolved` event persisted under the module's earlier verb name for an unusable delivery
- **WHEN** the import stream is replayed and its status is projected
- **THEN** the fold settles the review and the history projects the current verb, exactly as for a natively-recorded one, with no error
