# cross-module-delivery

Durable in-process event delivery between module event stores (design D3–D7): catch-up subscriptions with consumer-owned checkpoints replacing the webhook transport, preserving its semantics — async, at-least-once, ordered, idempotently consumed.

## ADDED Requirements

### Requirement: Catch-up subscription over the producer's store

A consuming module SHALL receive the producing module's integration events by reading the producer's event store in gapless, monotonically increasing global-position order, starting strictly after its own checkpoint. No outbox table SHALL exist; the producer's event store is the sole source of the feed.

#### Scenario: Events delivered in order from checkpoint

- **WHEN** the producer has committed events at positions N+1..N+k and the consumer's checkpoint is N
- **THEN** the consumer processes exactly positions N+1..N+k, in ascending position order, with no gaps or duplicates within the batch

#### Scenario: Tolerant consumption is preserved

- **WHEN** the consumer reads an event whose type it does not handle, or whose payload carries unknown fields
- **THEN** the consumer advances past it without failing, reading only the fields its consumer-owned schema declares

### Requirement: Checkpoint is consumer-owned, atomic with effects, named, and resettable

Each subscription SHALL persist its checkpoint as a named row in the consuming module's own SQLite store, and the checkpoint advance MUST commit in the same transaction as the consumer's effects for the processed batch. Distinct subscriptions SHALL have independent checkpoints, and a checkpoint MUST be resettable to an earlier position for replay.

#### Scenario: Effects and checkpoint commit together

- **WHEN** the consumer processes a batch and the process is killed at any single point during processing
- **THEN** after restart either both the batch's effects and the checkpoint advance are present, or neither is

#### Scenario: Checkpoint reset replays the feed

- **WHEN** an operator resets a subscription's checkpoint to position 0
- **THEN** the subscription reprocesses the full feed from the beginning and its idempotent consumption converges to the same end state

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

### Requirement: No cross-file atomicity

No step of the delivery mechanism SHALL require an atomic write spanning both modules' store files, and the two files MUST NOT be attached to a single database connection. The checkpoint MUST always lag the producer's committed position, never lead it.

#### Scenario: Worst case is redelivery, never loss

- **WHEN** the process crashes at any point in the produce–deliver–consume sequence
- **THEN** recovery may reprocess events but can never skip an event or record a checkpoint beyond what the consumer has committed effects for

### Requirement: Poison-event policy per subscription

A subscription SHALL retry a failing event a bounded number of times with backoff; on exhaustion it SHALL apply its declared policy: **halt** (stop the subscription without advancing, surfacing the stall via structured logs) or **park** (record the event's position and error as a dead-letter row in the consumer's store, then advance). Each subscription MUST declare exactly one policy.

#### Scenario: Halt preserves order

- **WHEN** an event exhausts its retries on a subscription declared `halt`
- **THEN** the subscription stops advancing, later events remain unprocessed, the stall is logged, and other subscriptions continue unaffected

#### Scenario: Park preserves progress

- **WHEN** an event exhausts its retries on a subscription declared `park`
- **THEN** a dead-letter row records the event's position and failure, and the subscription continues with the next event
