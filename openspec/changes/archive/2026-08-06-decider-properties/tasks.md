# Tasks — decider-properties

Sequencing: after `mutation-gate` (its survivor data picks the first target aggregate).
Red-first applies to properties too: each property is written expected-to-hold, but any
counterexample it finds becomes a red-first fix before the property is committed green.

> **Implementation note.** `mutation-gate` had not been implemented when this change was
> built, so no survivor data existed. The first target aggregate was chosen by reasoning
> about the two deciders instead — see design.md D6 (downloader Acquisition), which also
> records that a later mutation baseline may argue for a different emphasis.

## 1. Harness

- [x] 1.1 Add `fast-check` + `@fast-check/vitest` pinned to both context packages; CI seed
      pinned via shared vitest/fc config; verify failure output prints seed +
      counterexample path and that a replay reproduces exactly.
- [x] 1.2 Confirm `pnpm check` stays seconds-order with the harness in place; record the
      baseline in `design.md` D3.

## 2. First aggregate (chosen by mutation survivor data)

- [x] 2.1 Command/event arbitraries beside the aggregate's test builders — closed-union
      exhaustive so a new variant is a compile error (or a completeness property where
      that's infeasible).
- [x] 2.2 Stateful sequence property: reachable-state invariants (the ones types can't
      express, named in constitution language).
- [x] 2.3 Decide-never-throws (every reachable state × generated command returns a
      Result) and evolve-totality properties.
- [x] 2.4 Fold determinism + prefix-fold consistency properties (the reactor contract).
- [x] 2.5 Upcaster round-trip property through the real store codec and registry
      (generated v1 shapes → v2 semantics).

## 3. Second aggregate

- [x] 3.1 Repeat 2.1–2.5 for the other package's aggregate, reusing harness patterns; any
      divergence in property shape is a design note, not silent drift.

## 4. Stretch — event-store concurrency model

- [x] 4.1 In-memory expected-version model + fast-check model-based commands against the
      SQLite store (append/read, success/conflict agreement). Skippable if 2–3 exhaust
      the change's budget; then filed as a `quality-gate` issue instead.

## 5. Gate

- [x] 5.1 `pnpm check` green with properties in the unit tier; wall-clock recorded.
- [x] 5.2 Version decision: `chore`/`test:` no bump; any property-found production defect
      ships red-first here as `fix:` (patch bump) with its implied spec delta.

> **5.2 outcome: no bump.** Every commit is `test:`, and the properties found **no production
> defect** — the seeded defects were all eventually caught, but none of them was real, and
> "eventually" is doing honest work in that sentence: several properties passed against a seeded
> defect on the first attempt and were rewritten before they bit (see design.md's vacuity risk).
> Every genuine bug the exercise exposed was in the *test code itself* — a vacuous redelivery
> property, an off-by-one in the store model's paging expectation, a property asserting the
> runner's own literal, and generators that never reached three of the cases their properties
> claimed to cover. `skip_specs: true` holds: no spec delta, no release.
