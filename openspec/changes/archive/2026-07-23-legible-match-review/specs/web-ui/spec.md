## MODIFIED Requirements

### Requirement: Import review resolution

The web UI SHALL let the user resolve a pending import review (matching the importer facade's resolve contract), at parity with the retired `resolve_review` MCP tool. Pending reviews SHALL be listed by the attention queue (see "The attention queue unifies work awaiting a human") rather than by an importer-only listing.

For a match-review, the web UI SHALL present the candidate's **actual differences** as the primary content, not beets' distance scores. It SHALL show a headline comparing the intended release (the submission hint, when present) with the candidate's identity (artist, album, source, release id); an album-field diff; and a per-track diff that marks retagged tracks, downloaded files matching no track, and candidate tracks no file supplies. The distance and per-penalty breakdown MAY still be shown but SHALL be secondary to the differences and accompanied by plain-language labels for beets' penalty names. When a review lacks the field-level differences (recorded before they were captured), the UI SHALL fall back to the distance/penalty presentation without error.

The web UI SHALL word the hint outcome truthfully: it SHALL state that the pinned release was not the best match only when the best candidate's release id differs from the pinned id, and otherwise (the best candidate is the pinned release) SHALL state that the pinned release matched but confidence was low. The ID-entry action SHALL be labeled as accepting a release id from any source beets can resolve, not MusicBrainz alone.

#### Scenario: Resolving a review

- **WHEN** a user resolves a pending review with a valid choice
- **THEN** the importer facade's resolve command is dispatched and the review leaves the attention queue

#### Scenario: Stale resolution is a modeled error

- **WHEN** a user resolves a review that is no longer pending
- **THEN** the UI shows the facade's modeled conflict error and the import's state is unchanged

#### Scenario: The review page shows what differs, not just how much

- **GIVEN** a match-review whose candidate retags a track, leaves a downloaded file unmatched, and is missing a track
- **WHEN** the user opens the review
- **THEN** the page shows the intended-vs-candidate headline, the album-field diff, and a per-track diff marking the retag, the extra file, and the missing track
- **AND** the penalty percentages, if shown, are secondary and plainly labeled

#### Scenario: A pinned release that merely scored low is not called contradicted

- **GIVEN** a match-review reached with a pinned release id whose best candidate is that same release
- **WHEN** the user opens the review
- **THEN** the page states the pinned release matched but confidence was low, not that the hint was contradicted

#### Scenario: A legacy review still renders

- **GIVEN** a match-review recorded before field-level differences were captured
- **WHEN** the user opens the review
- **THEN** the page renders the distance/penalty view and the resolution actions, without error

#### Scenario: Picking a candidate and entering an id are the two match actions

- **GIVEN** a match-review with candidates
- **WHEN** the user views the resolution actions
- **THEN** they can apply one of the listed candidates or enter a release id (labeled as accepting any source beets resolves) to re-propose
