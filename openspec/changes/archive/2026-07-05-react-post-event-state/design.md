# react-post-event-state — Design

## Context

`Reactor.process` (src/application/acquisition/reactor.ts) reads the whole stream, folds it via `Acquisition.fromHistory`, and calls `reactTo(stored.event)` — so `react(event, state)` receives the aggregate's *latest* folded state, not the state as of the event. Two divergences follow:

1. **Co-emission.** `decide` emits batches (`[Imported, AcquisitionFulfilled]`, `[failure, CandidateRejected, selectNext]`, `[SearchCompleted, CandidatesRanked, CandidateSelected]`). Reacting to a non-final event of a batch folds its successors into `state`. Today this is papered over by rule 1 of the doc-comment contract in `src/domain/acquisition/react.ts:26-36`: such reactions must key off the event payload.
2. **Redelivery.** In the crash window (effect dispatched, follow-on events appended, checkpoint unsaved), a redelivered event sees far-future state. Today rule 2 exploits this: phase-guard mismatch suppresses the re-fire — an *accidental* suppression the documented contract ("at-least-once delivery + idempotent effects", `docs/development/event-sourcing.md`) never promised.

Literature survey (two independent sweeps, July 2026): no source hands a reaction the emitting aggregate's latest fold. The canonical shape is Chassaing's `Process`/`collectFold` — for event *i*, react sees state folded over events *1..i* (evolve one event, then react) — mirrored by Axon/NServiceBus/MassTransit sagas, CQRS Journey's process manager, and EventStoreDB projection discipline (state at position N ≡ fold of 1..N). The alternative canonical shape, fmodel's stateless `react: Event -> Command[]`, would require fattening ~5 persisted event schemas with targets, policies, and file lists; rejected in the proposal as more invasive for no gain, since our reactor subscribes to a single aggregate's own stream — exactly the case where the prefix fold *is* the process's own state.

Constraints: domain stays pure; 100% coverage; no breaking changes to public contracts; `acquisition-aggregate` spec requires the reactor to obtain effects through the facade without touching the fold directly.

## Goals / Non-Goals

**Goals:**

- `react(event, state)` receives the state as of the event: fold of the stream prefix up to and including it. Deterministic: first delivery, redelivery, and replay all pair an event with the same state.
- Retire the two-rule workaround contract in `react`'s doc-comment; re-ground the phase guards as type-narrowing + tolerant-fold totality checks.
- Make the crash-window redelivery path convergent by construction (idempotent effects + `decide` staleness guards + reactor checkpoint semantics), pinned by tests.

**Non-Goals:**

- No stateless/event-carried-state rework of `react` (fmodel shape) — no persisted event schema changes.
- No change to checkpoint granularity, bus delivery, or effect interpretation order.
- No cross-aggregate process manager; the reactor remains a single-stream prefix-folding consumer.
- Not fixing the pre-existing lack of effect *cancellation* (tracked separately).

## Decisions

### D1 — The reactor folds the prefix by stream `version`

`Reactor.process` slices the stream it already reads: `entries.filter((e) => e.version <= stored.version)` before `Acquisition.fromHistory(...)`. `version` is the per-stream monotone sequence (`StoredEvent.version`), the natural prefix key; `globalSeq` would also work but mixes in a store-global concern. No new port method, no second read — same I/O as today.

*Alternative considered:* a `readStreamUpTo(streamId, version)` port method — rejected; the filter is pure, the stream is already in memory, and the port surface stays minimal.

### D2 — The `Acquisition` facade API is unchanged

`Acquisition.fromHistory(prefix).reactTo(event)` already composes fold-then-react; the reactor simply supplies the prefix instead of the whole history. `reactTo` folds the prefix *including* the event, matching Chassaing's evolve-then-react ordering exactly. The `acquisition-aggregate` boundary (reactor never touches the fold directly) is preserved.

### D3 — Phase guards become totality checks, not temporal suppressors

Under the prefix fold, each guard's phase is (for well-formed histories) implied by the event just folded: `SearchRequested → Searching`, `CandidateSelected → Downloading`, `DownloadCompleted → Validating`, `ValidationPassed → Importing`, `ImportConflicted → Conflicted`. The guards stay — they are TypeScript narrowing over the `AcquisitionState` union and, per the tolerant-fold requirement (corrupted/edited histories fold to the prior state), they fall through to no effects when an event did not actually move the phase. The doc-comment is rewritten to say exactly this; rules 1 and 2 are deleted.

### D4 — `Imported → Cleanup` stays payload-keyed

`evolve` treats `Imported` as a state no-op (`state.ts`), so its post-event state is still `Importing` and `state.current` is available — the workaround *could* be removed. It stays keyed off `event.candidate` anyway: the event already carries the identity, event-carried data is the stronger convention, and it keeps the reaction total without a guard. Only the comment justifying it changes (from "the folded state is already Fulfilled" to "the event carries the identity"). Same for `CandidateRejected → Cleanup`.

### D5 — The reactor checkpoints past domain rejections; only infra faults retry

This is the one behavioral companion the prefix fold requires. In the crash window, a re-fired effect's follow-on command can now reach `decide` against a stream that already recorded the outcome. `decide` already handles staleness two ways: terminal state → `ok([])` (benign no-op), non-terminal wrong phase → `err(IllegalTransition)`. Today `Reactor.process` treats *every* `Err` from `interpretEffect` as retriable (no checkpoint advance) — a re-fired stale effect that earns an `IllegalTransition` would re-fire again on every catch-up, forever.

`CommandError = DomainError | AppendError` already carries the distinction. The reactor changes to: **domain rejection → log at warn, advance the checkpoint** (the stream has spoken; retrying cannot change the answer); **infra fault (`InfraError`/`ConcurrencyConflict`) → log at error, do not advance** (retry on next catch-up), as today.

*Alternative considered:* widening `decide` to return `ok([])` for all mid-flow stale `Record*` commands — rejected; `err(IllegalTransition)` is the protocol-violation tripwire for genuinely buggy callers, and weakening it in the domain to serve a delivery-layer concern inverts the dependency direction of the design.

### D6 — Crash-window convergence is pinned by tests, per effect family

The redelivery matrix the new tests cover (effect dispatched + follow-on appended + checkpoint unsaved + restart):

| Redelivered event | Re-fired effect | Convergence path |
| --- | --- | --- |
| `Imported` | `Cleanup` | `discardStaging` idempotent on absent staging |
| `ValidationPassed` | `Import` | library reports conflict/no-op; `RecordImported`/`RecordImportConflict` vs terminal state → `ok([])` |
| `CandidateSelected` | `Download` | wasted transfer; `RecordDownloadCompleted` vs advanced state → terminal `ok([])` or `IllegalTransition` → D5 checkpoints past it |
| co-emitted batch, first delivery | per-event effects | prefix fold: each event reacts against its own post-state (e.g. `Imported` sees `Importing` with `current`, not `Fulfilled`) |

Plus the determinism property test: for any history and any position, `react`'s output for event *i* is identical whether or not events beyond *i* exist.

### D7 — Constitution doc updated

`docs/development/event-sourcing.md` line for `react` becomes: `(event, state) -> effects` where `state` is the state **as of the event** (fold up to and including it). One line; the decide/evolve/react loop description is otherwise already accurate.

## Risks / Trade-offs

- **[Lost accidental suppression] A crash-window redelivery now re-fires real effects (worst case: a duplicate download of an album).** → The window is the gap between the follow-on append and the checkpoint save — two adjacent awaits in `process()`; a crash mid-*download* (the minutes-long part) leaves the stream un-advanced, where re-firing is the *correct* at-least-once recovery, unchanged from today. The wasted-transfer case requires the crash to land between append and checkpoint; accepted as at-least-once cost, converges via D5.
- **[Retry-loop hazard if D5 is skipped] Prefix fold without the domain-rejection checkpoint rule can loop a stale re-fire on every catch-up.** → D5 ships in the same change; the crash-window test fails without it.
- **[Guard vacuity drift] Future readers may delete the phase guards as dead code since they "always" pass.** → The rewritten doc-comment states their totality/narrowing role; the tolerant-fold spec scenario (corrupted history → no effects) keeps them covered by tests.
- **[Behavioral diff at first delivery] None expected — every co-emitted non-final event's reaction is payload-keyed or effect-free today — but the whole-stream fold has been live since bootstrap.** → The existing unit/e2e suites run unchanged; the determinism property test guards the new invariant.

## Migration Plan

No persisted data, schema, or API changes; the checkpoint format is untouched. Deploy is a normal release; rollback is a normal revert. A reactor restarted mid-catch-up across the version boundary sees only the new fold semantics, which are a strict refinement.

## Open Questions

None. (Whether `Imported` should read state instead of payload was considered and resolved as D4.)
