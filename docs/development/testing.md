# Testing

We develop test-first. Every line of production code exists to satisfy a test written **before** it. No exceptions, no "I'll add tests after."

## Red-green-refactor

1. **Red** — write the smallest failing test expressing the next desired behavior.
2. **Green** — write the minimum production code to make it pass.
3. **Refactor** — improve the design with the tests as a safety net.

Production code is only ever added inside this loop. If you're writing code with no red test driving it, stop.

## Coverage

100% coverage, enforced in CI as a hard gate. Coverage is a *floor*, not a target — it proves every line was reached by a test, not that behavior is well specified. Chase behaviors, and let coverage fall out.

## The pyramid

Many fast unit tests over pure logic; fewer integration tests over adapters against fakes; fewest end-to-end tests over the wired system. Push logic down into the pure core so most of it is covered by the cheap, fast tier. Never reach for a real external service where a fake proves the same behavior.

## Tests read like a specification

Write behavior in **given / when / then**. A test describes *what the caller observes*, not *how the code works internally* — it should survive a refactor untouched. Name scenarios in the language of the domain. Only drop to technical detail when it's the only way to cover a line that behavior-level tests can't reach.

## What to test

- Test observable behavior and contracts, not private methods or incidental structure.
- Every behavior gets a test; every edge and failure mode gets a test.
- Tests are deterministic and isolated — no shared mutable state, no real clock/network/filesystem in unit tests.
- A bug fix begins with a failing test that reproduces it.

## Test doubles

Prefer **fakes** (working in-memory implementations of a port) over mocks that assert on interactions. Test through the public contract; don't couple tests to internal call sequences.
