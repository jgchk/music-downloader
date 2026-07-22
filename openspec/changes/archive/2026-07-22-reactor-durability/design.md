## Context

The reactor is a single durable consumer over the global event log: it reacts to each event, dispatches effects serially, and advances one checkpoint. Two failure modes observed in production (2026-07-22, acquisitions `1e1bae5d` and `155d1887`):

1. A retryable effect failure leaves the checkpoint unadvanced, so the *same* event re-fires on every wakeup — correct for genuinely transient faults, but a permanent condition misclassified as transient (schema drift, invalid input reaching a 4xx) blocks every acquisition behind it, forever. Fixed 5s retries also hammered the upstream (inviting MusicBrainz throttling) until an unbounded fetch froze the drain outright (the fetch timeout shipped in v3.3.1 bounds that; the wedge class remains).
2. Long-running effects (a download's poll loop) live only in process memory. After the triggering event is checkpointed, a restart orphans the effect: the spec required "not downloaded a second time" and the implementation honored it by never driving the download again. Stall/queue-wait budgets are enforced by the dead poller, so nothing ever times out either.

## Goals / Non-Goals

**Goals:**
- One acquisition's failing effect must never stall another acquisition's progress.
- Every retry loop is bounded and lands somewhere modeled and visible.
- After a restart, every non-terminal acquisition is driven again: resumed, re-attached, or timed out by policy — never orphaned.

**Non-Goals:**
- Multi-process/distributed reactors, competing consumers, or parallel effect dispatch within a stream (serial per stream remains the concurrency model).
- Changing the decider or the at-least-once/idempotent-effect contract — this change is confined to the shell that drives it.
- Surfacing stalled acquisitions in the UI (the `unified-attention-queue` change consumes what this change exposes).

## Decisions

### D1 — Park the stream, advance the checkpoint

On a retryable effect failure, the reactor durably records a parked entry `{ streamId, globalSeq, attempt, nextRetryAt }` (a sibling table to the checkpoint store) and advances the global checkpoint past the event. The drain never re-processes a parked event in-line; a retry scheduler re-dispatches parked entries when due. Per-stream ordering is preserved by parking the *stream*: while a stream has a parked entry, later events for that stream are appended to its parked queue instead of being dispatched (other streams flow past untouched). **Invariant: a parked stream's event N+1 must never leapfrog N** — pinned by a dedicated test. This replaces the current semantics where the global checkpoint is the retry mechanism.

*Prior art:* "park" is the literal term in EventStoreDB/Kurrent persistent subscriptions (`maxRetryCount` → park → `replayParked`); the sibling retry table is the universal SQL job-queue schema (Oban/River/pg-boss `attempt`/`scheduled_at`/discard columns; Solid Queue's sibling execution tables). The per-stream variant — park the key, queue its later work behind, let other keys flow — is the rarer, ordering-preserving shape shipped by Confluent Parallel Consumer's KEY mode and jet/propulsion's `StreamsSink`; most off-the-shelf DLQs (SQS, Service Bus, Kurrent's own parking) explicitly lose per-key ordering, which is why we do not use them raw. Our bounded budget + terminal policy fixes Parallel Consumer's two documented gaps (retry-forever default, no dead-letter path); durability fixes Propulsion's memory-only buffering.

### D2 — Exponential backoff with a budget; the landing is modeled

Parked entries retry on exponential backoff with jitter (e.g. 5s → 10s → … capped at 15min) up to a retry budget measured in **wall-clock time** (default ~6h, configurable via environment), not attempts alone. Errors classified **non-retryable** (a 4xx-shaped permanent condition the adapter recognizes) short-circuit the budget entirely and land immediately — the Temporal non-retryable-error-types / Restate `TerminalError` split; the v3.2.1 and v3.3.1 incidents were both misclassified permanents burning retries. A budget exhausted resolves by effect kind:
- Effects whose permanent failure has a modeled business outcome degrade to it through the normal command path — `ResolveMetadata` → `RecordMetadataFailed` (the acquisition terminates visibly as `MetadataFailed`, exactly as if resolution had reported unresolved).
- Effects with no modeled failure (e.g. `Cleanup`) dead-letter: the parked entry moves to the existing dead-letter store with full context, is logged at error, and the acquisition is exposed as stalled in the status read model (`stalled: true` on the view — additive), which the attention queue can surface.
The budget is deliberately generous: a genuine outage should ride it out; only a permanent condition exhausts it. Dead-lettered/stalled entries get a retention policy (pruned after resolution or a bounded age, like River's discarded-job pruning) — a dead-letter table nobody drains is, per Dudycz, "a car alarm in a parking lot."

*Prior art:* bounded-retry-then-modeled-fallback is textbook under several names — AWS Step Functions `Retry`→`Catch`→fallback state, Temporal activity retry policies (`maximumAttempts`, Schedule-To-Close as the wall-clock budget) with `ActivityFailure` caught by workflow logic, Hohpe's write-off, Helland's "apologies." Restate 1.5's pause-on-exhaustion is the industry converging on exactly our two-tier landing (modeled outcome vs. stalled-awaiting-operator).

### D3 — Startup re-drive derives effects from state, not from replayed events

This is level-triggered reconciliation (the Kubernetes controller model) applied to the reactor: derive pending work from *current state* rather than from possibly-missed edges, so a crash is self-healing by construction. The standard industrial alternatives (Temporal server-side activity timeouts, DBOS's boot-time PENDING-workflow scan, outbox re-scans) re-drive from a durable work record; deriving from the fold is equivalent here because every effect is preceded by the event that implies it — a property the decider architecture already guarantees and this design depends on.

After the catch-up drain, a re-drive pass folds every non-terminal stream and asks `react(lastEvent, state)` for the effect its current state is waiting on, then dispatches it through the normal idempotent path. The pass is **rate-limited/jittered** (reconciling every non-terminal stream at boot must not stampede MusicBrainz or slskd) and **serialized per stream with normal dispatch** (the boot pass and the live drain must not race a check-then-act re-attach on the same acquisition). Consequences per phase: `Pending` re-fires resolution; `Searching`/`Selecting` re-fire search/selection continuation; `Downloading` re-fires the download effect, whose adapter must **reconcile before enqueueing** — via the source-resource ledger and slskd's transfer listing, it re-attaches to an existing live transfer (resuming polling and restarting stall/queue budgets from re-attach time) or re-enqueues if the source lost it; `AwaitingManualSelection` derives no effect (the pause is the state, not a lost effect); terminal phases are skipped. Idempotency and decide's stale-outcome rejection make double-drive safe by the existing contract.

### D4 — Boot must not wait behind the backlog

Today the composed process awaits the downloader runtime's startup catch-up drain inside `init`, and the drain executes effects inline — a backlog containing real work (an album download) keeps the web server unbound for its duration (observed 2026-07-22: ~2h UI outage). The fix: `createDownloaderRuntime` returns once stores and timers are wired; the catch-up drain and the D3 re-drive pass run in the background on the reactor's own scheduling. Ordering guarantees are unaffected (the drain is serial per stream regardless of who awaits it); the interface's runtime-baseline guarantee weakens deliberately from "all pending work done before serving" to "the module is wired and draining before serving" — which is what a level-triggered reactor wants anyway.

### D5 — Observability is part of the contract

Parked/dead-lettered state is queryable (count + per-acquisition) through the status read model, and every park, retry, degrade, and dead-letter transition logs structured entries with the acquisition id, effect type, attempt, and next retry. The two incidents were prolonged by silence; the fix treats visibility as a requirement, not a nicety.

## Risks / Trade-offs

- **Parking machinery adds state beside the log** (parked table) → kept rebuildable-adjacent: entries carry only scheduling data; losing the table safely degrades to the startup re-drive (D3), which re-derives work from the log.
- **Degrading to `MetadataFailed` after budget could terminate an acquisition during an extended provider outage** → the budget is hours-long and configurable; the alternative (infinite retry) is the bug this change removes. The landing is visible and the request can be resubmitted.
- **Download re-attach depends on slskd cooperation** (finding the prior transfer) → the ledger already records source resources per acquisition; where reconciliation is ambiguous, re-enqueue and let slskd/decide dedupe — worst case matches today's at-least-once contract.
- **Per-stream parking adds ordering bookkeeping** → scoped: only streams with a parked entry queue their later events; the common path (no failures) is unchanged; the no-leapfrog invariant is pinned by test.
- **Park-table rot** → retention policy for resolved/aged entries plus the stalled read-model exposure; the table is scheduling data only and safely degrades to the boot reconciliation if lost.
- **Boot-time thundering herd** → the re-drive pass is jittered and rate-limited (general retry-storm guidance; MusicBrainz rate limits are real and bit us on 2026-07-22).
