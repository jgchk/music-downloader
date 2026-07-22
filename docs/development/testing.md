# Testing

We develop test-first. Every line of production code exists to satisfy a test written **before** it. No exceptions, no "I'll add tests after."

## Red-green-refactor

1. **Red** — write the smallest failing test expressing the next desired behavior.
2. **Green** — write the minimum production code to make it pass.
3. **Refactor** — improve the design with the tests as a safety net.

Production code is only ever added inside this loop. If you're writing code with no red test driving it, stop.

## Coverage

100% coverage, enforced in CI as a hard gate. Coverage is a *floor*, not a target — it proves every line was reached by a test, not that behavior is well specified. Chase behaviors, and let coverage fall out.

The floor's meaning: an uncovered line is either a missing behavioral spec or dead code — never noise. What it must **not** produce is fiction: a test written only to execute lines specifies nothing and camouflages itself as specification. When a line resists honest behavioral coverage, work this ladder in order:

1. **Delete it** — if the types already prove the branch unreachable, it is dead code.
2. **Type it away** — parse at the boundary, make the illegal state unrepresentable, use compile-time exhaustiveness instead of a runtime `default: throw`.
3. **Humble it** — push plumbing into a thin adapter covered by its integration/contract tier, not branch-by-branch unit tests.
4. **Generalize it** — a family of mechanical edge cases becomes one property-style test with an honest name (e.g. a round-trip law), not an unnameable example zoo.
5. **Name it honestly** — a technical test is legitimate when it states an observable behavior of the unit in developer language; error-path tests that assert a returned error value are contract behavior, not plumbing.

Only when every rung fails — a genuine crash barrier the type system cannot see through — annotate an explicit, justified waiver instead of writing a contrived test:

```ts
/* v8 ignore next 2 -- crash barrier: unreachable because <the proof>; kept as defense against <the hazard> */
```

A waiver is reviewed like an `any`: rare, justified inline, and rejected if a rung of the ladder would have worked. The gate then still means something exact: every line is either specified behavior or an explicitly reviewed waiver.

## The pyramid

Many fast unit tests over pure logic; fewer integration tests over adapters against fakes; fewest end-to-end tests over the wired system. Push logic down into the pure core so most of it is covered by the cheap, fast tier. Never reach for a real external service where a fake proves the same behavior.

## Tests read like a specification

Write behavior in **given / when / then**. A test describes *what the caller observes*, not *how the code works internally* — it should survive a refactor untouched. Name scenarios in the language of the domain.

Tests come in two registers, for two audiences. **Business-facing** tests speak the domain's language — a domain-familiar reader should follow the name and body as a requirement. **Technology-facing** tests (serialization guards, storage edge cases, protocol details) speak developer language — and that's correct, not a compromise. Both registers state an observable behavior as a sentence; neither register is "covers line 47". Never dress a technical test in invented business framing, and never let a business behavior hide behind technical vocabulary.

## What to test

- Test observable behavior and contracts, not private methods or incidental structure.
- Every behavior gets a test; every edge and failure mode gets a test.
- Tests are deterministic and isolated — no shared mutable state, no real clock/network/filesystem in unit tests.
- A bug fix begins with a failing test that reproduces it.

## Test doubles

Prefer **fakes** (working in-memory implementations of a port) over mocks that assert on interactions. Test through the public contract; don't couple tests to internal call sequences.
