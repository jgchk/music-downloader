# cross-module-delivery — delta for close-enforcement-gaps

## ADDED Requirements

### Requirement: An unreadable checkpoint halts the subscription instead of replaying

A subscription whose durable checkpoint cannot be read SHALL NOT infer a position. It SHALL
deliver nothing, leave the durable checkpoint untouched, report its module's readiness as down,
and log the fault — a faulted read MUST NOT be treated as "never checkpointed" (position 0),
because that silently replays the producer's entire history behind a healthy readiness signal.
Recovery SHALL be a restart once the store reads, or an explicit reset to a chosen position.

#### Scenario: A faulted checkpoint read delivers nothing

- **WHEN** a subscription starts and reading its durable checkpoint fails
- **THEN** no event is delivered, the durable checkpoint is unchanged, and the module's
  readiness reports down naming the fault

#### Scenario: A genuinely fresh subscription still starts at the beginning

- **WHEN** a subscription starts and its checkpoint read succeeds with no stored position
- **THEN** it processes the feed from the beginning as a fresh consumer

### Requirement: A checkpoint reset is serialized against delivery

A checkpoint reset SHALL be serialized against the subscription's own delivery loop: an
in-flight drain SHALL complete before the reset's save, and no new drain SHALL start while the
save is in flight. A reset reporting success MUST mean the durable checkpoint holds the
requested position — never a position a concurrent delivery advanced past it.

#### Scenario: A concurrent delivery cannot falsify a successful reset

- **WHEN** an operator resets a subscription's checkpoint while a delivery cycle is draining
- **THEN** the reset reports success only once the durable checkpoint holds the requested
  position, with no advance from that cycle landing behind it
