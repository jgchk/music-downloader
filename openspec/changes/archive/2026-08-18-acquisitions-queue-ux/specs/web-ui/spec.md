## ADDED Requirements

### Requirement: The acquisitions queue reads newest first

The acquisitions master list SHALL present acquisitions ordered by when each was requested, newest first, so the entries a user most recently created — the ones they most likely came to check — are visible without scrolling. The ordering SHALL be keyed on the acquisition's stated requested-at fact, not on storage or replay order. This ordering applies to the acquisitions master list only; the attention queue keeps its own longest-waiting-first ordering.

#### Scenario: Newest request appears at the top

- **WHEN** a user views the acquisitions master list while acquisitions requested at different times exist
- **THEN** the list presents them newest-requested first, with the most recent request at the top

#### Scenario: A newly submitted request leads the queue

- **WHEN** a user submits a new download request and returns to the acquisitions view
- **THEN** the new acquisition appears at the top of the master list

### Requirement: Small screens present one acquisitions pane at a time

At narrow viewport widths — below the acquisitions view's existing side-by-side breakpoint — the acquisition detail and new-request routes SHALL present only the detail pane: the master queue SHALL be hidden such that it is absent from the accessibility tree and keyboard-focus order, not merely invisible. A "Back to queue" link SHALL appear at the top of the detail pane's content at these widths, returning the user to the acquisitions list; it SHALL be present on deep-linked entry as well as in-app navigation. The list route keeps its current presentation at all widths, and wide viewports keep the two-pane presentation unchanged.

DOM source order SHALL remain list-then-detail at every width — the collapse hides, and never reorders, content (per the accessibility requirements of the presentation capability).

#### Scenario: The new-request form is immediately visible on a small screen

- **WHEN** a user on a narrow viewport opens the new-request route
- **THEN** the request form is presented without the queue above it, and the form is reachable without scrolling past queue entries

#### Scenario: An acquisition's detail stands alone on a small screen

- **WHEN** a user on a narrow viewport opens an acquisition's detail — by selecting it from the queue or by following a deep link
- **THEN** only that acquisition's detail is presented, with a "Back to queue" link at the top of the pane

#### Scenario: The hidden queue is out of the keyboard-focus order

- **WHEN** a user on a narrow viewport tabs through the new-request or detail route
- **THEN** focus never enters the hidden queue pane

#### Scenario: Wide viewports keep both panes

- **WHEN** a user at a wide viewport opens the new-request or detail route
- **THEN** the queue and the detail pane present side by side exactly as before
