# Event Sourcing & Event-Driven Design

State is derived from an append-only log of events. The events are the source of truth; current state is a fold over them. We pair this with the functional **decider** pattern and event-driven reactions.

## Events are facts

An event records something that happened, in the past tense, as an immutable fact. Events are never edited or deleted. They capture business-meaningful transitions — not incidental telemetry.

## The decider: decide / evolve / react

- **decide** `(command, state) -> events` — the decision logic. Pure. Validates a command against current state and yields the events it produces (or a domain error). **All intelligence lives here.**
- **evolve** `(state, event) -> state` — folds an event into state. Pure and total.
- **react** `(event, state) -> effects` — a thin reflex that turns an event into descriptions of side effects. No logic, no I/O.

An imperative shell runs the loop: load events → fold to state → decide → persist events → react → run effects → feed results back as new commands. The decider stays pure; only the shell touches the outside world.

## Decisions in `decide`, effects in `react`

The valuable, testable logic belongs in `decide`. `react` never decides — it maps "this happened" to "do that." Effect results re-enter as commands and pass back through `decide`, which guards against stale or illegal transitions, giving idempotency for free.

## The aggregate is the decider's public face

The decider is functional, but it is not the domain's public surface. Each aggregate wraps its decider behind a small facade class: rehydrate it from history, then `execute` a command or `reactTo` an event. `decide`, `evolve`, `react`, and the folded state shape are the aggregate's **private engine** — reachable only from within the aggregate's own module, sealed from every other layer (lint-enforced). Only the aggregate class, its commands, events, effects, and a read snapshot / phase are visible outside the domain.

This keeps the functional core and its mock-free, given-events → when-command → then-events tests intact — the tests exercise the facade — while giving the domain one named, encapsulated entry point instead of scattered free functions. The aggregate stays **pure and immutable**: `execute` returns events as a value; nothing here folds-in-place, tracks uncommitted events, or performs I/O. The imperative shell still owns the loop below.

## Event-driven reactions

Components react to events rather than calling each other directly. Reactions must be **idempotent** and **durable**: track a checkpoint of what's been processed and resume after a restart without double-acting (at-least-once delivery + idempotent effects).

## Projections / read models

Query models are projections built by folding events. They are disposable and rebuildable — never a second source of truth. Commands go through the decider; queries read projections (CQRS).

## Schema evolution

Events live forever, so their schema is bound by the no-breaking-change policy (see api-compatibility.md). Version every event type and **upcast** older versions to current on read. Build the upcasting seam from the start.

## Events vs logs

Domain events are durable business truth in the store. Operational logs are ephemeral diagnostics (see logging.md). They are different streams and never substitute for each other — don't reconstruct state from logs, and don't record business facts only in logs.
