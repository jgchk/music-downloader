## MODIFIED Requirements

### Requirement: Acquisition progress observation

The web UI SHALL show the user each acquisition's current phase and outcome (including failure reasons) from the downloader facade's read models.

Failure reasons SHALL be surfaced through already-visible outcome text — the inline outcome summary on the list and detail views, and the per-candidate history log on the detail view — and SHALL NOT be duplicated behind a separate expandable control that reveals the same reasons. The phase badge SHALL be a status indicator only and SHALL NOT carry a reason-revealing disclosure. No reason-revealing affordance SHALL be presented for an acquisition that has no reasons to show (for example, a cancelled acquisition), so that the user is never offered a control that leads to an empty result.

#### Scenario: Progress listing

- **WHEN** a user opens the acquisitions view while acquisitions exist in various phases
- **THEN** each acquisition renders with its phase, target description, and, for terminal states, its outcome or failure reason

#### Scenario: Failure reasons are shown once, not behind a redundant control

- **WHEN** a user views a failed acquisition whose history carries failure reasons
- **THEN** those reasons appear in the acquisition's visible outcome text
- **AND** the phase badge presents no separate control to expand or reveal the same reasons

#### Scenario: No reason control when there is nothing to reveal

- **WHEN** a user views an acquisition whose terminal state carries no failure reasons
- **THEN** no reason-revealing affordance is presented, rather than a control that expands to an empty or "no reasons" message
