# react-post-event-state

## Why

The reactor folds the **whole** event stream and hands the aggregate's *latest* folded state to `react` for every event, so a reaction to event *N* can see state produced by events *N+1..M* — diverging from the event's own post-state whenever `decide` co-emits events (e.g. `Imported` + `AcquisitionFulfilled`) and whenever an event is redelivered after the stream has advanced. This has forced payload-keyed workarounds and a two-rule doc-comment contract in `react` (see `src/domain/acquisition/react.ts`), and it makes `react` a non-deterministic function of the event (its output depends on *when* the event is processed, not just *what* happened).

A literature survey (Chassaing's decider/Process `collectFold`, fmodel's Saga, Equinox/Propulsion, Axon/NServiceBus/MassTransit sagas, CQRS Journey's process manager, EventStoreDB projections, Fowler, Greg Young) found **no precedent** for reacting against the latest whole-stream fold. The canonical shape — Chassaing's `Process`, and every framework saga's "own state advanced one event at a time" — is: `react` for event *N* sees state folded over events *1..N*, never further.

## What Changes

- The reactor computes the state passed to `react` as the fold of the stream **prefix up to and including the event being reacted to** (post-event state), instead of the whole stream.
- `react` becomes a deterministic function of the stream prefix: same event, same effects, at first delivery and at any redelivery or replay.
- The whole-stream-fold workaround contract in `react`'s doc-comment (rule 1: "key off the event's own payload, never the folded state"; rule 2: phase guards double as redelivery suppressors) is retired; reactions may rely on the folded post-event state, and phase narrowing becomes a type-level projection of the event→phase correspondence rather than a temporal guard.
- Redelivery protection is carried entirely by the documented contract that was always in force — checkpoint dedupe + idempotent effects + `decide` rejecting stale results — no longer partially and accidentally by latest-state phase mismatches. A crash-window test (effect dispatched, checkpoint unsaved, restart) pins this down.
- `docs/development/event-sourcing.md` is clarified: the `state` in `react (event, state) -> effects` is the state **as of the event**.

## Capabilities

### New Capabilities

None.

### Modified Capabilities

- `acquisition-aggregate`: the reaction contract gains a requirement that reacting to an event computes effects against the state as of that event (fold of history up to and including it), replacing the unstated "latest folded state" behavior. The behavior-preservation clause ("reaction SHALL be the existing reaction function") is superseded for reaction-state semantics.
- `acquisition-lifecycle`: the "Processing survives restarts without duplicating effects" requirement gains an explicit at-least-once crash-window scenario — an effect whose event was dispatched but not yet checkpointed is re-dispatched on restart, and re-dispatch converges (no duplicate import, no corrupted library state).

## Impact

- `src/application/acquisition/reactor.ts` — `process()` folds only entries up to the delivered event's position before calling `reactTo`.
- `src/domain/acquisition/acquisition.ts` — the `Acquisition` facade's rehydration/`reactTo` pairing is used with prefix history (API may be unchanged; the reactor supplies the prefix).
- `src/domain/acquisition/react.ts` — doc-comment contract rewritten; reactions that were forced onto event payloads (`Imported → Cleanup`) may read post-event state or stay payload-keyed (design decision); phase-narrowing guards re-justified as totality checks, not redelivery suppressors.
- `src/application/acquisition/reactor.test.ts` — new co-emission and crash-window scenarios; existing checkpoint scenarios unchanged.
- `docs/development/event-sourcing.md` — one-line clarification of `react`'s state parameter.
- No public API, HTTP/MCP contract, or persisted event schema changes. No breaking changes.
