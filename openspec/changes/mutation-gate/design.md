# Design — mutation-gate

## Context

Research verdict #1 (`docs/research/automated-quality-function.md`): line coverage is the
gate's one measured weakness, and mutation testing at diff time is the production-proven
fix. The Google recipe (ICSE-SEIP 2018, TSE 2021, ICSE 2021) is the design template —
mutate changed covered lines only, suppress arid nodes, ≤1 surfaced mutant per line — with
one deliberate deviation from Google's deployment, argued below (D2).

Grilled decisions implemented here: diff-blocking PR job (no score threshold), weekly full
run filing issues, `pnpm test:mutation` local-on-demand but never in `pnpm check`
(seconds-local rule), both context packages all layers, web excluded-but-tracked,
composition via suppression, initial full run seeds the arid list.

## Goals / Non-Goals

**Goals**

- Surviving-mutant-on-changed-lines as a required PR check, finding-shaped for `/ship`
  convergence.
- Weekly full-run drift surfacing via GitHub issues (label `mutation-drift`).
- Arid suppression discipline identical to the `v8 ignore` waiver doctrine.
- Local runnability without commit-gate tax.

**Non-Goals**

- No global mutation-score threshold or badge. No web-package mutation (tracked deferred).
- No custom mutators; StrykerJS defaults first, tuned only on evidence from the full runs.
- No per-commit local enforcement.

## Decisions

### D1 — Failure condition is per-mutant on changed lines, not a score

A score threshold drifts with unrelated changes, punishes refactors that shrink the
denominator, and invites appeasement tests tuned to a number. A named surviving mutant is
deterministic, local to the diff, and converges exactly like a review finding: kill or
justify. This also keeps the check inside the deterministic-floor admission contract — its
false positives are auditable one mutant at a time.

### D2 — Blocking gate (deviation from Google's advisory deployment)

Google surfaces mutants as advisory review comments because a human reviewer absorbs noise
with a shrug and their arid heuristics are tuned by years of ignore-signal. This factory
has no human in the loop to shrug — advisory output has no consumer (the Meta
nightly-batch lesson), so the gate blocks. The compensations for blocking with an untuned
arid list: scope starts narrower than Google's (D3), the initial full run seeds the arid
list *before* the check becomes required, and suppression is cheap but justified. End state
is Google-shaped scope with a matured list.

### D3 — Scope: both context packages, all layers; web excluded-but-tracked

Adapters stay in scope — a surviving error-mapping mutant is precisely a tolerant-reader
assertion gap the contract tier should have caught. The web package is out: StrykerJS
cannot instrument `.svelte`, so inclusion would mutate only the BFF fragments while
looking like full coverage — a partial gate that reads as a whole one is worse than a named
exclusion. Composition roots stay in scope with per-site arid suppression rather than
directory exclusion. Deferred item: web joins when instrumentation exists or a BFF-only
scope is accepted *explicitly*.

### D4 — Two-tier deployment: incremental PR job + weekly full run

PR job: Stryker incremental mode, mutating files changed vs the merge-base, cache
persisted via CI cache keyed on main's head. Known caveat, accepted with eyes open: the
vitest runner's per-test filtering is coarser than Jest's, so incremental runs re-test more
than strictly needed; measured during adoption, and if PR wall-clock exceeds ~10 minutes
routinely, the first tuning lever is Stryker's `--concurrency`, the second is narrowing
`mutate` globs to the diff explicitly. Weekly job: full-repo run on main, files one issue
per surviving mutant cluster (per file), label `mutation-drift`, closing duplicates by
title match so the queue stays deduplicated.

### D5 — The check becomes required only after the seeding run

Order inside the change: land config + scripts + CI job non-required → run the initial
full-repo pass → triage into kills/suppressions until main is mutant-clean → *then* Jake
flips the job to required in the ruleset. Flipping first would block every PR on
pre-existing debt that no diff owns.

## Risks / Trade-offs

- **CI wall-clock.** Incremental + changed-files scoping bounds the PR job; the full run is
  weekly and off the critical path. Measured, with named tuning levers (D4).
- **Arid-list infancy.** First weeks will surface suppression candidates; that triage is
  the tuning mechanism, not a failure of it (research pitfall list: unproductive mutants).
- **Appeasement risk shifts, not vanishes** — an agent could kill a mutant with a
  change-detector test. Mitigation: test-quality-reviewer already hunts
  refactoring-brittle tests; mutation findings feed the same review loop, not a bypass.
- **jj/git interplay:** CI sees plain git; merge-base diffing is unaffected by jj locally.

## Migration Plan

Ships as one change; the required-check flip (Jake) is the last task and the only
irreversible-ish step, reversible by unflipping. Rollback = delete workflow + config;
no runtime surface.

## Open Questions

- None blocking. Incremental-cache hit rates and the vitest-runner overhead are
  measurements taken during adoption, recorded here.
