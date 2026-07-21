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

## Redaction

Never log secrets, credentials, tokens, or sensitive payloads. Redaction is configured centrally so it can't be forgotten at an individual call site.

## Keep logging out of the domain

The pure domain performs **no logging** — logging is a side effect and would break purity and testability. It lives in the application shell, adapters, and interfaces, and this is enforced by the dependency rule.

## Logs are not events

Operational logs are ephemeral diagnostics; domain events are durable business truth (see event-sourcing.md). Don't reconstruct state from logs, and don't put business facts only in logs.
