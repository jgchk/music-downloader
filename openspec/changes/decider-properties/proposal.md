# Proposal: decider-properties

## Why

The event-sourced core's guarantees — decide never throws, evolve is total over every event
the stream can contain, folds are deterministic, upcasted history means what v2 says — are
currently pinned by example-based tests: strong on the paths an author thought of, silent on
generated interleavings nobody wrote down. The research base
(`docs/research/automated-quality-function.md`, 2026-08-05) ranks property-based
model-conformance testing as the highest-value addition after the mutation gate, on the
Amazon S3 ShardStore precedent (SOSP 2021: lightweight executable-model PBT caught 16
production issues pre-release and stayed maintainable by non-specialists) — TLA+-class value
without a second toolchain, and deterministic in CI under pinned seeds.

## What Changes

- **fast-check + `@fast-check/vitest` join the unit tier** (inside `pnpm check` — a few
  hundred runs over pure functions is well inside the seconds budget).
- **Per-aggregate stateful property suites** in both bounded-context packages: generated
  command sequences (valid and invalid interleavings) driven through the real
  decide→evolve fold, asserting **invariants** — no reachable state violates the
  aggregate's stated invariants beyond what types already forbid; `decide` returns a value
  (never throws) on every reachable state × command; `evolve` is total over every event —
  and **oracle properties**: fold determinism, prefix-fold consistency (state after *n*
  events then event *n+1* equals the fold of *n+1* — the reactor's prefix-fold contract,
  mechanized), and upcaster round-trips (v1 events through the store codec and upcasters
  evolve to what v2 semantics document).
- **No parallel decider models.** Deciders are already pure functions — a hand-written
  reference model would be a drifting near-duplicate the factory could "fix" into agreement
  with a buggy decider. Properties assert *relations and invariants*, not conformance to a
  second implementation.
- **One small reference model where a real implementation/model gap exists** (stretch): the
  event store's optimistic-concurrency semantics against an in-memory ten-line model —
  that seam has genuine stateful complexity (SQLite, transactions) a simple model can
  oracle.
- **Seed policy:** pinned seed in CI for determinism; on failure the counterexample's
  `seed`/`path` is printed for exact local replay.

## Capabilities

### New Capabilities

<!-- none -->

### Modified Capabilities

<!-- none — test-tier only; no spec-level behavior changes (skip_specs: true).
     If a property finds a real defect, its fix ships with whatever spec delta
     that defect implies, as its own finding. -->

## Impact

- **Code:** new property-test files in both packages' unit tiers, two dev dependencies,
  possibly small test-support arbitraries (command/event generators) colocated with test
  builders.
- **Version:** `chore`/`test:` — no bump, unless a property surfaces a production defect
  (then that fix is red-first and bumps as `fix:`).
- **Dependencies:** after `mutation-gate` — its weekly survivor data points at the weakest
  decider branches, real input for where properties should bite first; no code coupling.
- **Risk retired:** generated-interleaving blind spots in the layer everything else trusts;
  the reactor prefix-fold and upcaster contracts get mechanized instead of remembered.
