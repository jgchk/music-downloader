# cross-module-delivery Specification

## Purpose

Guarantee durable in-process event delivery between the modules' event stores: catch-up subscriptions with consumer-owned checkpoints replacing the webhook transport while preserving its semantics — asynchronous, at-least-once, ordered, idempotently consumed, and crash-safe.

## Requirements
### Requirement: Catch-up subscription over the producer's store

A consuming module SHALL receive the producing module's integration events by reading the producer's event store in gapless, monotonically increasing global-position order, starting strictly after its own checkpoint. No outbox table SHALL exist; the producer's event store is the sole source of the feed.

#### Scenario: Events delivered in order from checkpoint

- **WHEN** the producer has committed events at positions N+1..N+k and the consumer's checkpoint is N
- **THEN** the consumer processes exactly positions N+1..N+k, in ascending position order, with no gaps or duplicates within the batch

#### Scenario: Tolerant consumption is preserved

- **WHEN** the consumer reads an event whose type it does not handle, or whose payload carries unknown fields
- **THEN** the consumer advances past it without failing, reading only the fields its consumer-owned schema declares

### Requirement: Checkpoint is consumer-owned, ordered after effects, named, and resettable

Each subscription SHALL persist its checkpoint as a named row in the consuming module's own SQLite store, and the checkpoint SHALL advance only after the batch's effects have durably committed in that store — the checkpoint MUST never lead the effects. Distinct subscriptions SHALL have independent checkpoints, and a checkpoint MUST be resettable to an earlier position for replay.

#### Scenario: A crash between effects and checkpoint converges via redelivery

- **WHEN** the consumer processes a batch and the process is killed at any single point during processing
- **THEN** after restart the checkpoint is never ahead of the committed effects, and any events redelivered from the held checkpoint converge idempotently to the same end state

#### Scenario: Checkpoint reset replays the feed

- **WHEN** an operator resets a subscription's checkpoint to position 0
- **THEN** the subscription reprocesses the full feed from the beginning and its idempotent consumption converges to the same end state

### Requirement: An unreadable checkpoint halts the subscription instead of replaying

A subscription whose durable checkpoint cannot be read SHALL NOT infer a position. It SHALL deliver nothing, leave the durable checkpoint untouched, report its module's readiness as down, and log the fault — a faulted read MUST NOT be treated as "never checkpointed" (position 0), because that silently replays the producer's entire history behind a healthy readiness signal. Recovery SHALL be a restart once the store reads, or an explicit reset to a chosen position.

#### Scenario: A faulted checkpoint read delivers nothing

- **WHEN** a subscription starts and reading its durable checkpoint fails
- **THEN** no event is delivered, the durable checkpoint is unchanged, the module's readiness reports down, and the fault itself is named in a structured log line

#### Scenario: A genuinely fresh subscription still starts at the beginning

- **WHEN** a subscription starts and its checkpoint read succeeds with no stored position
- **THEN** it processes the feed from the beginning as a fresh consumer

### Requirement: Delivery survives process crash

Delivery SHALL be at-least-once and durable: an event committed by the producer before a crash MUST be delivered to every subscription after restart, and redelivery of an already-processed event MUST converge to a no-op.

#### Scenario: Crash between produce and consume

- **WHEN** the producer commits an event and the process crashes before the consumer has processed it
- **THEN** after restart the consumer processes that event without any external re-trigger

#### Scenario: Redelivery converges

- **WHEN** a crash occurs after the consumer's effects transaction commits but the same event is delivered again (e.g. after a checkpoint reset)
- **THEN** reprocessing produces no additional effects

### Requirement: Notify-then-poll delivery loop

The subscription loop SHALL poll on startup before waiting, SHALL treat any in-process wakeup signal as a lossy latency hint only, and SHALL run a periodic fallback poll that alone guarantees delivery. Batches MUST be bounded in size and the loop MUST yield between batches.

#### Scenario: Lost wakeup does not lose delivery

- **WHEN** the producer commits an event and every in-process wakeup signal is dropped
- **THEN** the consumer still processes the event within one fallback poll interval

#### Scenario: Startup catch-up

- **WHEN** the process starts with the consumer's checkpoint behind the producer's head
- **THEN** the subscription drains the backlog in bounded batches before entering its steady-state wait

### Requirement: Stopping a subscription waits out its in-flight delivery

Stopping a subscription SHALL detach its wakeup listener and fallback timer AND wait for any delivery cycle already in flight to stop touching the store. Detaching alone only cancels the next cycle; the caller closes the module's event-store handle once the stop completes, so a cycle still draining would read the feed and save checkpoints against a closed handle.

#### Scenario: A stop does not complete while a delivery is still draining

- **WHEN** a subscription is stopped while a delivery cycle is mid-drain
- **THEN** the stop completes only after that cycle has finished, so no store access follows it

### Requirement: A checkpoint reset is serialized against delivery

A checkpoint reset SHALL be serialized against the subscription's own delivery loop: an in-flight drain SHALL complete before the reset's save, and no new drain SHALL start while the save is in flight. A reset reporting success MUST mean the durable checkpoint holds the requested position — never a position a concurrent delivery advanced past it.

#### Scenario: A concurrent delivery cannot falsify a successful reset

- **WHEN** an operator resets a subscription's checkpoint while a delivery cycle is draining
- **THEN** the reset reports success only once the durable checkpoint holds the requested position, with no advance from that cycle landing behind it

### Requirement: No cross-file atomicity

No step of the delivery mechanism SHALL require an atomic write spanning both modules' store files, and the two files MUST NOT be attached to a single database connection. The checkpoint MUST always lag the producer's committed position, never lead it.

#### Scenario: Worst case is redelivery, never loss

- **WHEN** the process crashes at any point in the produce–deliver–consume sequence
- **THEN** recovery may reprocess events but can never skip an event or record a checkpoint beyond what the consumer has committed effects for

### Requirement: Poison-event policy per subscription

A subscription SHALL retry a failing event a bounded number of times with backoff; on exhaustion it SHALL **halt**: stop the subscription without advancing the checkpoint, surfacing the stall via structured logs, leaving later events unprocessed and other subscriptions unaffected. Failures classified transient SHALL hold the checkpoint for redelivery (the fallback poll retries them indefinitely) rather than counting toward exhaustion-halt; only failures classified permanent halt the subscription. Recovery from a halt is a restart (or explicit reset) after the defect is fixed: the subscription resumes from the held checkpoint in order.

#### Scenario: Halt preserves order

- **WHEN** an event exhausts its retries on a subscription
- **THEN** the subscription stops advancing, later events remain unprocessed, the stall is logged, and other subscriptions continue unaffected

#### Scenario: Restart after a fix is the redrive

- **WHEN** a halted subscription's process restarts after the causing defect is fixed
- **THEN** the subscription resumes from the held checkpoint and processes the formerly poison event and all successors in feed order, with no event skipped

#### Scenario: Transient failure holds without halting

- **WHEN** an event's handler reports a transient failure
- **THEN** the checkpoint is not advanced, the event is redelivered by the poll loop, and the subscription does not halt

### Requirement: A permanent render defect at the feed halts the subscription

A subscription whose feed reports a PERMANENT payload-rendering defect SHALL halt rather than hold: it SHALL deliver nothing further, leave the durable checkpoint where it is (never skipping the position), report its module's readiness as down, and log the defect. A retry cannot resolve a producer mapping defect, so holding-and-retrying would block that position and everything behind it indefinitely behind a healthy readiness signal. A feed failure of any other kind SHALL remain a transient hold that the fallback poll retries. Both subscriptions SHALL behave identically here.

The kind that denotes a permanent render defect crosses the module boundary as a bare string, because the consumer's feed port is structural and importing the producer's error type would be a shared kernel. Each module SHALL therefore declare the seam-error kinds it publishes in an artifact its own contract tier owns, and producer and consumer SHALL each be pinned against it.

#### Scenario: A render defect halts instead of wedging the seam

- **WHEN** a subscription reads its producer's feed and the read fails with the producer's declared permanent render-defect kind
- **THEN** the subscription halts, the durable checkpoint is unchanged, and the module's readiness reports down

#### Scenario: Any other feed failure stays retryable

- **WHEN** the same read fails with any other kind
- **THEN** the subscription holds the checkpoint without halting, and a later poll delivers
