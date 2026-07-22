## ADDED Requirements

### Requirement: An acquisition awaiting edition selection pauses until a choice is made

The system SHALL, when metadata resolution yields a manual-selection outcome (a release-group request whose group has no official edition), pause the acquisition in an awaiting-selection state that retains the candidate editions, rather than searching or failing. While awaiting selection the acquisition SHALL perform no search, download, or import. The system SHALL resume the acquisition only on an explicit edition selection or a cancellation. On selection of a candidate edition, the system SHALL resolve that edition into the canonical target — identical to resolving the chosen release by its identifier — and continue the normal acquisition flow. Selection SHALL be accepted only while the acquisition is awaiting selection; a selection naming an edition that is not among the retained candidates, or arriving in any other state, SHALL be rejected as a modeled error without altering the acquisition.

#### Scenario: A group with no official edition pauses for selection

- **GIVEN** an acquisition whose release-group request resolves to a group with candidate editions but no official edition
- **WHEN** metadata resolution completes
- **THEN** the acquisition enters the awaiting-selection state retaining the candidate editions
- **AND** no search, download, or import is performed while it waits

#### Scenario: Selecting an edition resumes the acquisition

- **GIVEN** an acquisition awaiting edition selection
- **WHEN** a caller selects one of the retained candidate editions
- **THEN** the system resolves that edition into the canonical target and the acquisition proceeds to search as if the target had been resolved directly

#### Scenario: An unknown or out-of-state selection is rejected

- **GIVEN** an acquisition that is awaiting edition selection
- **WHEN** a selection names an edition that is not among the retained candidates
- **THEN** the system rejects the selection as a modeled error and the acquisition remains awaiting selection
- **AND** a selection submitted for an acquisition that is not awaiting selection is likewise rejected without effect

#### Scenario: Cancelling while awaiting selection ends the acquisition

- **GIVEN** an acquisition awaiting edition selection
- **WHEN** the acquisition is cancelled
- **THEN** the acquisition terminates through the normal cancellation path without selecting an edition
