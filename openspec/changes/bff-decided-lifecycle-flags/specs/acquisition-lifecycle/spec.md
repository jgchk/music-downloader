## ADDED Requirements

### Requirement: The acquisition status read model exposes decided lifecycle flags

The acquisition status read model SHALL expose the acquisition's own decided lifecycle facts as fields on the status view, so a consumer renders them rather than re-deriving them from the status enum. It SHALL expose whether the acquisition is **cancellable** — true exactly when a cancellation would still do something, which is the same condition the cancel decision uses (a non-terminal acquisition), and false for every terminal acquisition — and whether the acquisition is **awaiting selection** — true exactly when it is paused for a human's edition choice. Both flags SHALL be additive on the status contract (absent-tolerant), and SHALL be the acquisition's own determination, not a value a consumer computes from the phase name.

#### Scenario: A non-terminal acquisition reports itself cancellable

- **GIVEN** an acquisition that has not reached a terminal state
- **WHEN** its status view is read
- **THEN** the view reports it as cancellable

#### Scenario: A terminal acquisition reports itself not cancellable

- **GIVEN** an acquisition that has reached a terminal state (fulfilled, exhausted, cancelled, metadata-failed, or conflicted)
- **WHEN** its status view is read
- **THEN** the view reports it as not cancellable

#### Scenario: An awaiting-selection acquisition reports itself awaiting a human

- **GIVEN** an acquisition paused for a manual edition choice
- **WHEN** its status view is read
- **THEN** the view reports it as awaiting selection, while an acquisition in any other phase reports it as not awaiting selection
