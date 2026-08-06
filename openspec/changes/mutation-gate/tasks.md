# Tasks — mutation-gate

Sequencing: after `deterministic-floor` merges (admission contract + lint fallout land
first, so the mutation baseline isn't invalidated by a repo-wide lint diff). The required
flip is last (D5) — the gate must not block on pre-existing debt.

## 1. Stryker adoption

- [ ] 1.1 Add `@stryker-mutator/core` + `@stryker-mutator/vitest-runner` pinned; config
      scoped to `packages/downloader/src` + `packages/importer/src`, incremental mode on,
      ≤1 surfaced mutant per line; web package named as excluded in config comments with
      the deferred-item pointer.
- [ ] 1.2 `pnpm test:mutation` script (incremental, local on demand); confirm `pnpm check`
      duration is untouched.
- [ ] 1.3 Initial full-repo run; capture the survivor inventory grouped by file/layer.

## 2. Seeding triage (main becomes mutant-clean)

- [ ] 2.1 Triage every survivor: kill with a strengthened/new test (red-first: watch the
      mutant survive, then kill) or suppress as arid with an inline justification
      (`v8 ignore` doctrine). Composition wiring via per-site suppression, never directory
      exclusion.
- [ ] 2.2 Record the seeding tally (killed / suppressed / per-layer distribution) in
      `design.md`; sanity-check the arid list against the admission contract
      (`docs/development/quality-gates.md`).

## 3. CI

- [ ] 3.1 PR workflow job: incremental Stryker over files changed vs merge-base, cache
      keyed on main head; failure = any surviving non-suppressed mutant on changed lines;
      per-mutant output in the job summary.
- [ ] 3.2 Weekly scheduled full run on main: file one `mutation-drift` issue per file
      cluster with mutant details, dedupe by title; create the label.
- [ ] 3.3 Measure PR-job wall-clock on a representative diff; record it and the tuning
      lever chosen (if any) in `design.md` D4.

## 4. Handoff

- [ ] 4.1 **Jake:** add the mutation PR job to the main-branch ruleset's required checks
      (after 2.x lands and the job is green on a real PR).
- [ ] 4.2 Note the web-package deferred item as a `quality-gate` issue (joins mutation
      scope when `.svelte` instrumentation exists or a BFF-only scope is explicitly
      accepted).

## 5. Gate

- [ ] 5.1 `pnpm check` green; version decision: `chore`, no bump.
