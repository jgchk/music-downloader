# acquisition-aggregate Specification

## Purpose

Define the encapsulation boundary of the acquisition domain: its decision logic (the functional decide/evolve/react decider and the folded state) is a private engine wrapped behind a single pure, immutable `Acquisition` aggregate facade. Every other layer interacts with acquisition behavior only through that facade, while commands, events, domain errors, effects, and phase remain the public contract.

## Requirements

### Requirement: The Acquisition aggregate is the sole entry point to acquisition decision logic
The domain SHALL expose acquisition decision logic exclusively through an `Acquisition` aggregate facade providing rehydration from history, command execution, and event reaction. Code outside the domain's acquisition module MUST NOT be able to import the decider internals (the state shape, initial state, fold, decision function, or reaction function); such an import SHALL fail the lint gate and therefore CI.

#### Scenario: Application code rehydrates and executes through the aggregate
- **WHEN** the command handler processes a command for an acquisition with a stored event history
- **THEN** it rehydrates via the aggregate's from-history constructor and obtains resulting events (or a domain error) from the aggregate's execute method, without touching the fold or decision functions directly

#### Scenario: The reactor obtains effects through the aggregate
- **WHEN** the reactor processes a stored event for an acquisition
- **THEN** it obtains the event's effects from the aggregate's react method, without folding state or calling the reaction function directly

#### Scenario: An out-of-boundary import of decider internals is rejected
- **WHEN** a module outside the domain's acquisition module imports the state module or the decision function
- **THEN** the lint gate fails the build

### Requirement: The aggregate is pure and immutable
The `Acquisition` aggregate SHALL perform no I/O, no logging, and no observable mutation: executing a command SHALL return the resulting events as a value (or a domain error as a value) and SHALL NOT change the aggregate instance.

#### Scenario: Execute is repeatable on the same instance
- **WHEN** the same command is executed twice on the same rehydrated aggregate instance
- **THEN** both calls return the same result and the aggregate's observable properties are unchanged

### Requirement: Commands, events, domain errors, effects, and phase remain the public contract
The domain SHALL keep acquisition commands, acquisition events, domain errors, effect descriptions, and the acquisition phase publicly importable, and the aggregate SHALL expose the current phase and whether the acquisition is terminal.

#### Scenario: A projection derives the phase through the aggregate
- **WHEN** a read model needs an acquisition's current phase for a status view
- **THEN** it rehydrates the aggregate from the event history and reads the phase property, without access to the rest of the internal state

### Requirement: Aggregate behavior is identical to the wrapped decider
Rehydration SHALL be the existing fold over events, execution SHALL be the existing decision function, and reaction SHALL be the existing reaction function; introducing the aggregate SHALL cause no change in any externally observable behavior.

#### Scenario: Decider test cases hold when phrased through the aggregate
- **WHEN** an existing given-events → when-command → then-events decider test case is rephrased as from-history → execute
- **THEN** it produces the same events or the same domain error as before

#### Scenario: End-to-end behavior is unchanged
- **WHEN** the existing end-to-end suite runs against the refactored build
- **THEN** all scenarios pass without modification to their assertions

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
