# Tasks — mutation-gate

Sequencing: after `deterministic-floor` merges (admission contract + lint fallout land
first, so the mutation baseline isn't invalidated by a repo-wide lint diff). The required
flip is last (D5) — the gate must not block on pre-existing debt.

## 1. Stryker adoption

- [x] 1.1 Add `@stryker-mutator/core` + `@stryker-mutator/vitest-runner` pinned; config
      scoped to `packages/downloader/src` + `packages/importer/src`, incremental mode on,
      ≤1 surfaced mutant per line; web package named as excluded in config comments with
      the deferred-item pointer.
      _Incremental mode landed opt-in per command instead — see design D4a for why the PR
      job must not use it. ≤1 mutant per line is a surfacing rule, applied in
      `scripts/mutation/summarize.ts` (Stryker has no generation-time equivalent)._
- [x] 1.2 `pnpm test:mutation` script (incremental, local on demand); confirm `pnpm check`
      duration is untouched.
      _`pnpm check` is unchanged: mutation is not a lane, pinned by
      `test/boundaries/mutation-scope.test.ts` ("stays out of the seconds-order commit gate")._
- [x] 1.3 Initial full-repo run; capture the survivor inventory grouped by file/layer.
      _Recorded in `design.md` — the seeding tally and the per-layer inventory._

## 2. Seeding triage (main becomes mutant-clean)

- [ ] 2.1 Triage every survivor: kill with a strengthened/new test (red-first: watch the
      mutant survive, then kill) or suppress as arid with an inline justification
      (`v8 ignore` doctrine). Composition wiring via per-site suppression, never directory
      exclusion.
      **464 → 19 on this branch; 64 at the rebased tip. Main is not mutant-clean.** The repo-wide triage was
      carried out file by file: 6717 mutants, 5712 killed, 77 timed out, 1015 ignored by the D6/D7
      class rejections, **19 surviving** at a mutation score of **99.67%** (from 92.21%). Every
      survivor of the 464 was killed with a real assertion, suppressed at the site with a written
      equivalence proof, deleted as dead code, or is one of the 19 listed in `design.md` with the
      reason it is left. No live defect was found — production was correct throughout — but a long
      list of durability and safety invariants had nothing behind them (staged-file cleanup on
      cancellation, the auto-apply threshold, the fallback poll, the seam's replay guarantee, five
      budget boundaries, peer redaction), and the dominant cause was not missing tests but tests
      whose fixtures could not fail. All of that is recorded in `design.md`.
      This checkbox stays open. Seventeen of the 19 are provably equivalent but deliberately NOT
      waived — `Stryker disable next-line` keys on (line, mutator), so waiving them would silence a
      killable twin on the same line, which is how the first draft of this work came to hide 104
      mutants the suite already killed. The other 2 are a genuine unspecified-behaviour finding in
      the MusicBrainz album path that no honest test can pin. And the rebase onto v3.18.0 added 45
      more from someone else's change, taking the tip to 64: main is not mutant-clean, and a one-off
      sweep cannot make it so while the diff gate stays inert. It therefore still blocks 4.1.
      _Superseded detail from the seeding pass follows._
      **464 survivors across 62 files; main was not mutant-clean.** Two
      false-finding classes were retired at the config site (D6 arid logging, D7 static
      mutants), taking the count from run 2's 807 to 472. Fifteen further mutants then left the
      survivor list — fourteen killed
      by real tests and one waived as provably equivalent: `quality-policy.ts` is now
      mutant-clean (11 → 0 measured against its ORIGINAL tests), `import/state.ts` 11 → 9,
      `import/decide.ts` 15 → 13 — including the seam watermark's max-fold, a
      genuine gap of the same class as the previously-unpinned optimistic-concurrency check.
      One equivalent condition was deleted rather than waived, and one provably equivalent
      mutant carries the repo's only inline suppression. The remaining inventory is recorded
      per layer in `design.md`. (Against run 4's 472 the net fall is 8, not 15: run 4 already
      carried a first pass at `quality-policy.ts`, and deleting the equivalent condition
      removed 6 mutants from the denominator rather than killing them.) This checkbox stays
      open, and it blocks 4.1.
- [x] 2.2 Record the seeding tally (killed / suppressed / per-layer distribution) in
      `design.md`; sanity-check the arid list against the admission contract
      (`docs/development/quality-gates.md`).
      _Recorded, including the mutator rule-pack triage: all 14 mutators admitted, two
      class-level rejections (D6, D7), and exactly one per-site suppression — a provably
      equivalent mutant in `decide.ts`, which also makes the boundary tier's justification
      scan run over a real waiver rather than an empty set._

## 3. CI

- [x] 3.1 PR workflow job: incremental Stryker over files changed vs merge-base, cache
      keyed on main head; failure = any surviving non-suppressed mutant on changed lines;
      per-mutant output in the job summary.
      _Fresh (not incremental) and without a cache — D4a. Scope is changed files vs the
      merge-base; the summary names each survivor, one per line._
- [x] 3.2 Weekly scheduled full run on main: file one `mutation-drift` issue per file
      cluster with mutant details, dedupe by title; create the label.
- [x] 3.3 Measure PR-job wall-clock on a representative diff; record it and the tuning
      lever chosen (if any) in `design.md` D4.
      _Measured in CI on this change's own PR (#161): 2m31s for the job, ~1m43s for the Stryker
      pass, over a real 2-file production diff — 372 mutants, 359 killed, 13 surviving. Well
      inside the 20-minute timeout, so no tuning lever was needed; recorded in `design.md`._

## 4. Handoff

- [ ] 4.1 **Jake:** add the mutation PR job to the main-branch ruleset's required checks
      (after 2.x lands and the job is green on a real PR).
      **STILL BLOCKED on 2.1, and it is a TWO-part flip.** Review established that a job
      which merely fails-without-being-required is the "warning nobody blocks on" shape
      quality-gates.md rejects: with 464 survivors across 62 files, roughly half of all
      production-touching PRs would show a red X for debt they did not create, and a loop
      that learns to ignore a red check ignores it when it is real. So the mutation step
      ships `continue-on-error: true`, and task 4.1 removes THAT flag and adds the required
      check together, in one step, once main is mutant-clean. Until then the job runs and
      reports on every PR, and the gate is inert by construction.
      **After the burn-down (464 → 19), `continue-on-error` was reviewed again and DELIBERATELY
      LEFT IN PLACE.** The argument is weaker than it was but it still holds, and it now turns on
      *which* files carry them: a PR touching `importer/domain/import/{state,import,decide}.ts`,
      `downloader/domain/shared/duration.ts` or `downloader/adapters/musicbrainz/mapping.ts` would
      show a red X for a survivor it did not create — and the three importer domain files are the
      decider itself, the most-edited code in the package. Removing the flag while that is
      true reproduces the rejected shape on a smaller scale. The two things that would clear it are
      named in `design.md`: split the four narrowing-operand lines so their waivers become precise,
      and settle the MusicBrainz empty-title question (a real finding, not a mutant to appease).
- [x] 4.2 Note the web-package deferred item as a `quality-gate` issue (joins mutation
      scope when `.svelte` instrumentation exists or a BFF-only scope is explicitly
      accepted).
      _Recorded as a deferred item in `stryker.config.mjs` and design D3, alongside the two
      new deferred items this adoption produced (D7's static-mutant blind spot, and the 2.1
      burn-down)._

## 5. Gate

- [x] 5.1 `pnpm check` green; version decision: `chore`, no bump.
