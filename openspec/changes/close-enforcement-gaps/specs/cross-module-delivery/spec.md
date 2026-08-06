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
- **THEN** no event is delivered, the durable checkpoint is unchanged, the module's readiness
  reports down, and the fault itself is named in a structured log line

#### Scenario: A genuinely fresh subscription still starts at the beginning

- **WHEN** a subscription starts and its checkpoint read succeeds with no stored position
- **THEN** it processes the feed from the beginning as a fresh consumer

### Requirement: A permanent render defect at the feed halts the subscription

A subscription whose feed reports a PERMANENT payload-rendering defect SHALL halt rather than
hold: it SHALL deliver nothing further, leave the durable checkpoint where it is (never skipping
the position), report its module's readiness as down, and log the defect. A retry cannot resolve a
producer mapping defect, so holding-and-retrying would block that position and everything behind
it indefinitely behind a healthy readiness signal. A feed failure of any other kind SHALL remain a
transient hold that the fallback poll retries. Both subscriptions SHALL behave identically here.

The kind that denotes a permanent render defect crosses the module boundary as a bare string,
because the consumer's feed port is structural and importing the producer's error type would be a
shared kernel. Each module SHALL therefore declare the seam-error kinds it publishes in an artifact
its own contract tier owns, and producer and consumer SHALL each be pinned against it.

#### Scenario: A render defect halts instead of wedging the seam

- **WHEN** a subscription reads its producer's feed and the read fails with the producer's
  declared permanent render-defect kind
- **THEN** the subscription halts, the durable checkpoint is unchanged, and the module's
  readiness reports down

#### Scenario: Any other feed failure stays retryable

- **WHEN** the same read fails with any other kind
- **THEN** the subscription holds the checkpoint without halting, and a later poll delivers

### Requirement: Stopping a subscription waits out its in-flight delivery

Stopping a subscription SHALL detach its wakeup listener and fallback timer AND wait for any
delivery cycle already in flight to stop touching the store. Detaching alone only cancels the next
cycle; the caller closes the module's event-store handle once the stop completes, so a cycle still
draining would read the feed and save checkpoints against a closed handle.

#### Scenario: A stop does not complete while a delivery is still draining

- **WHEN** a subscription is stopped while a delivery cycle is mid-drain
- **THEN** the stop completes only after that cycle has finished, so no store access follows it

### Requirement: A checkpoint reset is serialized against delivery

A checkpoint reset SHALL be serialized against the subscription's own delivery loop: an
in-flight drain SHALL complete before the reset's save, and no new drain SHALL start while the
save is in flight. A reset reporting success MUST mean the durable checkpoint holds the
requested position — never a position a concurrent delivery advanced past it.

#### Scenario: A concurrent delivery cannot falsify a successful reset

- **WHEN** an operator resets a subscription's checkpoint while a delivery cycle is draining
- **THEN** the reset reports success only once the durable checkpoint holds the requested
  position, with no advance from that cycle landing behind it
