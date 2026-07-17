## ADDED Requirements

### Requirement: Rehydration is a total, tolerant fold
Rehydrating an acquisition from its event history SHALL be a total fold: it SHALL never throw and SHALL never produce a state whose data is inconsistent with its phase. An event that does not fit the phase the history has reached (possible only for corrupted or externally edited histories, since the decision function is the sole event producer) SHALL be ignored — the fold returns the prior state unchanged — so that the stream remains foldable and a compensating event can still take effect. Protocol violations SHALL surface as typed domain errors on the next command executed against the folded state, not during rehydration.

#### Scenario: An out-of-protocol event is ignored during replay
- **WHEN** a history containing an event that is illegal for the phase reached at that point (for example, a download completion before any candidate was selected) is folded
- **THEN** the fold ignores that event, the resulting state reflects only the legal prefix of the history, and no exception is thrown

#### Scenario: The next command on a tolerantly folded state is rejected with a typed error
- **WHEN** a command that the resulting phase does not permit is executed against an aggregate rehydrated from such a history
- **THEN** execution returns an illegal-transition domain error as a value

#### Scenario: Every event type is ignored by every non-matching phase
- **WHEN** each acquisition event type is applied, in isolation, to a state in each phase that is not a legal source phase for that event
- **THEN** the fold returns the input state unchanged in every combination
