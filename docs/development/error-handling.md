# Error Handling

Errors are **values**, not control flow. We use neverthrow's `Result` / `ResultAsync` and do not throw for expected failures.

## Expected vs unexpected

The core distinction:

- **Expected failures** are part of the model — an operation that legitimately can't proceed, input that doesn't validate, a search that finds nothing. Represent them as values (a `Result` error, or a domain event) and handle them explicitly.
- **Unexpected faults** are bugs or environmental breakage — a service unreachable, a disk error, a violated invariant. These surface through the error channel and are handled at a boundary that can decide what to do (retry, dead-letter, surface a fault to the caller).

Business sadness is **not** an error. Model it as a first-class outcome, not an exception.

## Conventions

- Functions that can fail return `Result<T, E>` (or `ResultAsync<T, E>`); they don't throw.
- Errors are **typed and meaningful** — no stringly-typed or catch-all errors that force callers to guess.
- Handle an error at the boundary that can actually make a decision, **once**. Don't log-and-rethrow; don't catch-and-swallow.
- **Never ignore a result.** An unhandled result is a bug, and the linter flags it.
- Adapters translate foreign errors (library exceptions, transport failures) into our typed results at the boundary — exceptions never leak inward.

## At the edges

Interface adapters map failures to their transport (invalid input → client error; unexpected fault → server error) *after* logging. Expected domain outcomes are not transport errors — they're normal responses describing what happened.
