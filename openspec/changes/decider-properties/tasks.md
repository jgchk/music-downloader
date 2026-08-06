# Tasks — decider-properties

Sequencing: after `mutation-gate` (its survivor data picks the first target aggregate).
Red-first applies to properties too: each property is written expected-to-hold, but any
counterexample it finds becomes a red-first fix before the property is committed green.

## 1. Harness

- [ ] 1.1 Add `fast-check` + `@fast-check/vitest` pinned to both context packages; CI seed
      pinned via shared vitest/fc config; verify failure output prints seed +
      counterexample path and that a replay reproduces exactly.
- [ ] 1.2 Confirm `pnpm check` stays seconds-order with the harness in place; record the
      baseline in `design.md` D3.

## 2. First aggregate (chosen by mutation survivor data)

- [ ] 2.1 Command/event arbitraries beside the aggregate's test builders — closed-union
      exhaustive so a new variant is a compile error (or a completeness property where
      that's infeasible).
- [ ] 2.2 Stateful sequence property: reachable-state invariants (the ones types can't
      express, named in constitution language).
- [ ] 2.3 Decide-never-throws (every reachable state × generated command returns a
      Result) and evolve-totality properties.
- [ ] 2.4 Fold determinism + prefix-fold consistency properties (the reactor contract).
- [ ] 2.5 Upcaster round-trip property through the real store codec and registry
      (generated v1 shapes → v2 semantics).

## 3. Second aggregate

- [ ] 3.1 Repeat 2.1–2.5 for the other package's aggregate, reusing harness patterns; any
      divergence in property shape is a design note, not silent drift.

## 4. Stretch — event-store concurrency model

- [ ] 4.1 In-memory expected-version model + fast-check model-based commands against the
      SQLite store (append/read, success/conflict agreement). Skippable if 2–3 exhaust
      the change's budget; then filed as a `quality-gate` issue instead.

## 5. Gate

- [ ] 5.1 `pnpm check` green with properties in the unit tier; wall-clock recorded.
- [ ] 5.2 Version decision: `chore`/`test:` no bump; any property-found production defect
      ships red-first here as `fix:` (patch bump) with its implied spec delta.
