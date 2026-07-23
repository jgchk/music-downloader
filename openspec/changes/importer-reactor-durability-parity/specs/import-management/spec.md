## ADDED Requirements

### Requirement: A failing import effect's retry budget is durable and a spent budget dead-letters visibly

The system SHALL bound retries of an import's failing effect by a configurable budget whose attempt tally is **durable**: the budget SHALL be counted in the module's own store, not in memory, so a process restart resumes the tally rather than resetting it to zero. While an effect fails retryably below its budget the reactor SHALL hold its checkpoint and re-drive the effect (on the fallback poll and after a restart) without advancing past it, so ordering is preserved and no later event leapfrogs the failing one. When the budget is exhausted the system SHALL dead-letter the event with its full effect context — recording the owning import stream — advance past it so one poison effect never wedges the global queue, and expose the owning import as **stalled** by the status read model. A stalled import SHALL be cleared once its stream is driven successfully again. Every retry and dead-letter transition SHALL be observably logged with the import, effect, and attempt.

#### Scenario: A retryable effect failure holds the checkpoint and counts the attempt durably

- **GIVEN** an import whose effect fails with an infrastructure fault below its retry budget
- **WHEN** the reactor processes the event
- **THEN** the checkpoint is not advanced and the attempt is recorded durably in the module's store

#### Scenario: The retry budget survives a restart instead of resetting to zero

- **GIVEN** an import whose effect has failed for part of its retry budget and the process then restarts
- **WHEN** the reactor resumes and re-drives the held event
- **THEN** it continues the attempt tally from where it left off and reaches the budget after the remaining attempts — it does NOT re-retry from a fresh budget on each restart

#### Scenario: An exhausted budget dead-letters and stalls the import visibly

- **GIVEN** an import whose effect fails on every attempt through the entire retry budget
- **WHEN** the final attempt fails
- **THEN** the event is dead-lettered with its effect context and owning import, the checkpoint advances past it, and the import is exposed as stalled by the status read model

#### Scenario: A dead-lettered import is seeded as stalled after a restart

- **GIVEN** a dead letter recorded for a reactor effect before the process restarted
- **WHEN** the runtime boots and seeds the stalled read model from the dead-letter store
- **THEN** the owning import reads as stalled through the facade without waiting for any new event

#### Scenario: A poison effect does not wedge other imports

- **WHEN** one import's effect exhausts its budget and dead-letters
- **THEN** the checkpoint advances past it and subsequent events are processed, rather than the global queue stalling behind the poison effect forever
