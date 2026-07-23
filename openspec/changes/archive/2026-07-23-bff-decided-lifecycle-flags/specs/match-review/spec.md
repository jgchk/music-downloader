## MODIFIED Requirements

### Requirement: Reviews resolve through explicit verbs, and rejection cleans intake

The system SHALL resolve review items through explicit verbs on the importer module's facade: apply a listed candidate, supply a release ID for a pinned re-propose (accepting any identifier a loaded beets source can resolve, not MusicBrainz alone), refresh the candidate list, apply a full manual tag payload (per-track fields with an explicit track mapping; beets applies them with autotagging bypassed, plugins still firing), import as-is, reject, and reject-and-retry-download. Rejecting SHALL delete the release's files from the intake directory. Reject-and-retry-download SHALL do everything reject does and SHALL additionally record a release verdict — the fact that the delivered release failed external validation — carrying the originating acquisition id, the delivered candidate's identity, and the reviewer's reasons; it SHALL be available only for imports that retain a delivered candidate's identity, and SHALL otherwise be refused with an error naming the missing precondition while plain reject remains available. Resolving an already-settled review SHALL be a tolerated no-op.

The module SHALL additionally expose, for each pending review, the set of resolution verbs permitted for that review — its **available actions** — as part of the pending-review item. This set SHALL be the module's own determination, computed from the review kind, whether the review carries candidates, and whether a delivered candidate is retained (the reject-and-retry-download precondition), and SHALL never include a verb the resolve decision would refuse for that review. A consumer SHALL therefore be able to offer exactly the legal verbs from this set rather than re-deriving per-kind legality itself. The available-action set SHALL be additive on the pending-review contract (absent-tolerant).

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

#### Scenario: A pending review carries its permitted verb set

- **GIVEN** a pending review of any kind
- **WHEN** it is read from the pending-review queue
- **THEN** it carries the set of resolution verbs permitted for it, and that set includes no verb the resolve decision would refuse for that review

#### Scenario: A review without a retained candidate omits the retry verb from its permitted set

- **GIVEN** a pending review for an import that retains no delivered candidate
- **WHEN** its permitted verb set is read
- **THEN** the set excludes reject-and-retry-download while still including plain reject

#### Scenario: A remediation review permits only its own verbs

- **GIVEN** a pending remediation review on an applied import
- **WHEN** its permitted verb set is read
- **THEN** the set contains exactly accept and retry-enrichment
