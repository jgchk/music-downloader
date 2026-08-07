# Logging & Observability

Logs are for operators and diagnostics. They are structured, leveled, and kept out of the pure core.

## Structured & leveled

Emit **structured** (JSON) logs, not free-form strings. Every entry has a level:

- **error** — a fault needing attention.
- **warn** — a recoverable or notable-but-handled condition.
- **info** — significant lifecycle milestones.
- **debug** — detailed diagnostics, off in normal operation.

Log level is configured via the environment.

## Logs as event streams

Treat logs as a stream written to stdout (twelve-factor). The application does not manage log files, rotation, or routing — the runtime/environment aggregates.

## Correlation

Every log line carries the identifiers needed to trace one unit of work end to end. You should be able to follow a single operation through the whole system by its correlation id.

Two identifiers, and they are not interchangeable:

- **correlation id** — the *story*. Minted exactly once, at the operation's outermost trigger, and copied **verbatim** through every subsequent hop, including across a module boundary. A consuming module adopts the id it is handed rather than minting its own; re-minting at a boundary is precisely what makes "through the whole system" untrue.
- **causation reference** — the *immediate parent*. Rewritten at every hop. Where the parent is a stored event, it is that event's store coordinates, namespaced by the store they address, rather than a newly invented identifier.

Beware: some frameworks invert these names. In this codebase they mean what is written above and nothing else.

**The pair is carried by the shell, never the domain.** It travels beside a command and lands in event metadata; deciders and evolve functions never see it. Correlation is a property of a unit of work, not a business fact, and a domain that learns the word starts folding it into state and persisting it inside payloads.

**Bind once, inherit everywhere.** Whoever starts a unit of work creates the child logger; everyone below logs through the logger they are handed. That is what lets an adapter's lines join the work in scope without the adapter knowing that correlation exists — and it is why adapters take a logger rather than owning one. Prefer explicit passing to ambient context in a codebase that already injects its dependencies.

**Retrofit additively, and never fabricate.** History written before correlation existed has none, permanently. Readers treat both identifiers as optional forever; nothing is backfilled and no upcaster invents provenance that did not happen. An absent id degrades the trace, never the work.

**Ids are diagnostics, not interface copy.** They belong in logs and stored metadata. Surfacing one in user-visible text drags the interface's test surface into every future change to correlation.

## Redaction

Never log secrets, credentials, tokens, or sensitive payloads. Redaction is configured centrally so it can't be forgotten at an individual call site.

## Keep logging out of the domain

The pure domain performs **no logging** — logging is a side effect and would break purity and testability. It lives in the application shell, adapters, and interfaces, and this is enforced by the dependency rule.

## Logs are not events

Operational logs are ephemeral diagnostics; domain events are durable business truth (see event-sourcing.md). Don't reconstruct state from logs, and don't put business facts only in logs.
