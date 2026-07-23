## MODIFIED Requirements

### Requirement: Acquisition progress observation

The web UI SHALL show the user each acquisition's current phase and outcome (including failure reasons) from the downloader facade's read models.

The acquisitions view SHALL present the acquisitions as a compact master list — each acquisition rendering its target description and a phase signal (its in-progress phase, or its terminal done/failed state) — beside a detail pane that shows the selected acquisition in full. Each acquisition's outcome (its deposited location, or its failure reason) SHALL be surfaced in the detail view for the selected acquisition, NOT as an inline column of the master list, so the master stays scannable and one long value (a file path or a multi-clause reason) cannot distort it.

Failure reasons SHALL be surfaced through already-visible outcome text — the outcome summary and the per-entry history log on the detail view — and SHALL NOT be duplicated behind a separate expandable control that reveals the same reasons. The phase badge SHALL be a status indicator only and SHALL NOT carry a reason-revealing disclosure. No reason-revealing affordance SHALL be presented for an acquisition that has no reasons to show (for example, a cancelled acquisition), so that the user is never offered a control that leads to an empty result.

#### Scenario: Progress listing

- **WHEN** a user opens the acquisitions view while acquisitions exist in various phases
- **THEN** each acquisition renders in the master list with its target description and a phase signal — its in-progress phase (for example, Downloading or Searching) or its terminal done/failed state

#### Scenario: Outcome is shown in the detail view on selection

- **WHEN** a user selects an acquisition
- **THEN** the detail view shows that acquisition's outcome — the deposited location for a fulfilled acquisition, or the failure reason for a failed one

#### Scenario: Failure reasons are shown once, not behind a redundant control

- **WHEN** a user views a failed acquisition whose history carries failure reasons
- **THEN** those reasons appear in the acquisition's visible outcome text on the detail view
- **AND** the phase badge presents no separate control to expand or reveal the same reasons

#### Scenario: No reason control when there is nothing to reveal

- **WHEN** a user views an acquisition whose terminal state carries no failure reasons
- **THEN** no reason-revealing affordance is presented, rather than a control that expands to an empty or "no reasons" message
