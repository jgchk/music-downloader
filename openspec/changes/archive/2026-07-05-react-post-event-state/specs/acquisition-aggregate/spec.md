# acquisition-aggregate — Delta

## ADDED Requirements

### Requirement: Reactions are computed against the state as of the event
When the system reacts to a stored event, the effects SHALL be computed against the acquisition state folded from the stream prefix up to and including that event — never from events recorded after it. Reaction is therefore a deterministic function of the stream prefix: reacting to the same event of the same stream SHALL yield the same effects at first delivery, at redelivery, and during replay, regardless of how far the stream has since advanced.

#### Scenario: A non-final co-emitted event reacts against its own post-state
- **WHEN** a decision co-emits an import event together with its fulfilment event, and the reactor reacts to the import event
- **THEN** the state used for the reaction reflects only the history up to and including the import event (the importing-phase data, with the current candidate available), not the fulfilled successor state

#### Scenario: A redelivered event produces the same effects as first delivery
- **WHEN** an already-reacted event is delivered again after the stream has recorded further events
- **THEN** reacting to it yields exactly the effects that were produced at first delivery
