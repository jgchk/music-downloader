# Proposal: mutation-gate

## Why

The 100% line-coverage gate proves every line *executes* under test; it does not prove any
test would *notice* the line going wrong. The research base
(`docs/research/automated-quality-function.md`, 2026-08-05) ranks closing this gap as the
single best next investment: coverage correlates only weakly with suite effectiveness once
suite size is controlled (Inozemtseva & Holmes, ICSE 2014), and in this factory the tests
are written by the same process that writes the code — coverage is the one axis where the
gate currently grades its own homework. Mutation testing is the standard instrument for
measuring detection rather than execution, with a production-proven recipe (Google,
ICSE-SEIP 2018 / TSE 2021): mutate only changed covered lines, suppress arid lines, at most
one mutant per line surfaced.

## What Changes

- **StrykerJS joins the repo** with a config covering all TypeScript production source in
  `packages/downloader` and `packages/importer` — every layer, adapters included (a mutant
  surviving the contract tier's fixture assertions is real signal about tolerant-reader
  strength). The SvelteKit web package is **excluded for now** (no `.svelte` instrumentation
  support; partial inclusion would be coverage that lies) and carried as a tracked deferred
  item — the end state is the Google shape, everything covered.
- **A blocking PR CI job**: mutation testing in incremental mode over the branch's changed
  files; the failure condition is **any surviving non-suppressed mutant on changed lines** —
  a deterministic, finding-shaped signal the `/ship` loop can converge on (kill it with a
  test, or suppress it as arid with an inline justification). No score threshold — a global
  percentage is drift-prone and Goodhart-shaped.
- **A weekly full run** over main (scheduled CI, non-blocking) files surviving mutants as
  GitHub issues, so assertion-strength drift in untouched code surfaces without blocking
  anyone.
- **`pnpm test:mutation`** runs the incremental check locally on demand. It is **not** part
  of `pnpm check` — the commit gate stays seconds-fast; minutes-order tools live in CI.
- **Arid-line suppression list** (logging calls, config plumbing, composition wiring) seeded
  from the initial full run's triage; every suppression is justified like a `v8 ignore`
  waiver. Composition roots are handled by suppression, not directory exclusion, so
  non-arid logic hiding in wiring still gets caught.

## Capabilities

### New Capabilities

- `mutation-testing`: what the mutation gate guarantees — changed lines carry
  mutant-killing tests or justified arid suppressions; full-repo drift is surfaced on a
  schedule; the gate never taxes the local commit loop.

### Modified Capabilities

<!-- none -->

## Impact

- **Code:** Stryker config + per-package scoping, CI workflow (PR job + weekly schedule),
  `pnpm test:mutation` script, suppression list, issue-filing step in the scheduled job.
- **Version:** `chore` — CI/tooling only, no bump.
- **Dependencies:** after `deterministic-floor` (its admission contract governs this gate's
  noise budget; its lint fallout should land before the first mutation baseline). StrykerJS's
  vitest runner has coarser incremental support than Jest's — accepted, measured during
  adoption.
- **Jake-only step:** adding the mutation PR job to the main-branch ruleset's required
  checks (repo settings are outside agent permissions).
- **Risk retired:** the self-grading axis — AI-written tests are now audited by an
  instrument that measures detection, not execution.
