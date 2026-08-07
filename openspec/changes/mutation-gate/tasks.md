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

## 2. Seeding triage (goal RETIRED: main cannot become mutant-clean — see 2.1)

- [x] 2.1 Triage every survivor: kill with a strengthened/new test (red-first: watch the
      mutant survive, then kill) or suppress as arid with an inline justification
      (`v8 ignore` doctrine). Composition wiring via per-site suppression, never directory
      exclusion.
      **CLOSED on the triage being complete with its residue recorded** — not on "main becomes
      mutant-clean", which `docs/research/blocking-mutation-gate-scope.md` §5.1 establishes is
      unreachable in principle rather than merely unreached: the equivalent fraction among
      *survivors* RISES as a suite improves (Schuler & Zeller), under 5% of mutants carry unique
      information at all, and Google calls mutation adequacy *"neither practical nor desirable"*.
      Twenty-seven unkillable survivors after a 464 → 19 → 27 burn-down is the literature's
      predicted outcome, not a residue of incomplete work; the exit criterion was the wrong one,
      and a task whose premise cannot exist cannot close by doing more of the same work.
      The residue is recorded in `design.md`: **7100 mutants, 929 ignored, 6083 killed, 61 timed
      out, 27 surviving — 99.56%**, all 27 provably equivalent and none of them waivable without
      silencing a killable twin (measured, not argued — see the v3.18.0 burn-down section).
      `mutation-gate-diff-scope` is what makes the residue harmless: under changed-LINE failure
      scope a mutant on a line no PR touched cannot fail that PR, so nothing has to be done to
      the 27 before a flip. When a PR does edit one of those lines, being asked to re-audit the
      equivalence claim is correct behaviour rather than friction.
      _Detail from the passes that got here follows, left in place so the record shows what
      changed._
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
      **64 → 27 (99.56%, re-measured on the shipped tree), and this checkbox can no longer be closed by triage at all.** v3.18.0's 45
      were burned down to 9 — 36 killed by real tests, none of which needed a production change —
      and the MusicBrainz album-title finding was FIXED rather than pinned (`comparableTitle` /
      `isSameTitle`: absence is now `undefined`, and absence matches nothing, including another
      absence), which retired those 2 survivors by removing the sentinel they lived on. One of the
      seventeen equivalents was retired by respelling a guard as `'candidates' in state`, the way its
      three neighbours already ask.
      The remaining **27 are all provably equivalent**, and the reason they cannot be waived is now
      MEASURED rather than argued. A `// Stryker disable` keys on (line, mutator); an ignore-plugin
      is consulted per AST **node**, before mutants exist, so its message lands on every mutant of
      that node. Neither is (node AND mutator). Across the 64, **38 sat on a node that also carries a
      killed mutant — including 17 of 17 of this family** — so a node-precise waiver silences real
      findings: running one proved it, taking a file from 96.67% to a false 100.00% by hiding three
      kills. The `ignore-unions` plugin `design.md` used to recommend should NOT be built.
      So triage is finished and the goal it served is unreachable by triage. Closing this needs a
      decision — `design.md` **D8**, a justified survivor baseline the JOB checks, which is precise
      to (file, line, mutator, replacement) and so cannot silence a twin. Deliberately not built
      here: it is a rule-pack decision that deserves its own change and its own grilling.
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
      inside the 20-minute timeout; no tuning lever was needed. Recorded in `design.md`. Note it is
      the SMALLEST of three runs now observed — the others are in
      `docs/research/blocking-mutation-gate-scope.md` §1, and §10 catalogues reading this one as
      representative. Raising the ceiling belongs to `mutation-gate-diff-scope` task 3.4._

## 4. Handoff

The flip is TWO tasks rather than one, and its criterion is a measurement rather than a state of
main. The old criterion — *"split the four narrowing-operand lines so their waivers become
precise"* — is **deleted, not weakened**: it is unreachable twice over, and it is recorded as
deleted here rather than silently dropped. There are seventeen of that mutator family, not four — twenty-seven survivors in all; and splitting cannot
work for this mutator family at all, because `ConditionalExpression` emits `true` *and* `false`
from one node and `EqualityOperator` emits both substitutions from one operator token, so the
equivalent and its killable twin are co-located whatever the formatting (`design.md` D10, measured
against Stryker 9.6.1). Contorting production code to make a tool's waiver fit is the appeasement
the admission contract exists to prevent.

`mutation-gate-diff-scope` replaces it with a criterion that is reachable: the failure scope
becomes the changed LINES, so the twenty-seven stop blocking without being suppressed, and the
verdict ships in shadow so its effective false-positive rate can be measured *here* before it
blocks anything. 4.1a and 4.1b then happen together, in one step, so the gate never spends time in
the "fails but is not required" shape `quality-gates.md` rejects.

- [ ] 4.1a Enable enforcement: set `MUTATION_GATE_ENFORCE=true` on the `mutation` job, once
      `mutation-gate-diff-scope` task 5.1's shadow measurement clears `quality-gates.md`'s
      ten-percent effective-false-positive bar on real PRs in this repository. If it does not
      clear, the honest outcome is to say so and leave the verdict in shadow — a check can be
      worth running once without earning a seat, and both halves get recorded either way.
- [ ] 4.1b **Jake:** add the mutation PR check to the main-branch ruleset's required checks, in
      the same step as 4.1a. Repo settings are outside agent permissions.
      _Historical record of how this task got here follows; the reasoning it contains is
      superseded above wherever the two disagree._
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
      **Both of those have now been attempted, and only one of them was possible.** The MusicBrainz
      question is settled — fixed, not appeased. Making the waivers precise is NOT possible: measured
      against Stryker 9.6.1, no mechanism it offers is (node AND mutator), so every available waiver
      for this family silences a killable twin. `continue-on-error` therefore stays, and 4.1 stays
      open.
      **This task's premise is retired, and 4.1 will not close in the form it is written.** It is
      blocked on 2.1, whose exit criterion is "main becomes mutant-clean" — and
      `docs/research/blocking-mutation-gate-scope.md` establishes from the literature that no suite
      reaches that state: the equivalent fraction among survivors rises as the suite improves. Read
      §5.1 and §9 there. Three hand burn-downs have now run and the gate has blocked nothing, so
      "wait for the burn-down to close" was never going to become a flip.
      **Superseded by `openspec/changes/mutation-gate-diff-scope/`**, which moves the failure scope
      from changed files to changed lines and ships it in shadow mode behind `MUTATION_GATE_ENFORCE`.
      Under it the equivalents stop blocking — a mutant on a line no PR touched cannot fail that PR —
      so this checkbox is superseded by 4.1a/4.1b above rather than completed as written. Two
      corrections it must carry, both wrong above and left in place so the record shows what changed:
      "split the four narrowing-operand lines" is unreachable (there are seventeen, and splitting
      cannot work for this mutator family), and "task 4.1 removes THAT flag" is reversed — diff-scope
      D5 keeps `continue-on-error` on the Stryker step and moves the verdict to a new step that does
      not carry it.
      **Not fixed here, deliberately:** `continue-on-error: true` covers the whole step, so it
      forgives Stryker CRASHING exactly as readily as it forgives survivors — a gate that greens on
      its own breakage, and shadow mode does not close it either. The finding, the `mutation.yml`
      precedent that already solved it, and why the exit code alone cannot tell the two apart are
      recorded in `design.md` under "Why the gate still stays inert". `mutation-gate-diff-scope` owns
      the job; this change makes no edit to `.github/workflows/pipeline.yml` so the two cannot
      contradict each other in the same file.
- [x] 4.2 Note the web-package deferred item as a `quality-gate` issue (joins mutation
      scope when `.svelte` instrumentation exists or a BFF-only scope is explicitly
      accepted).
      _Recorded as a deferred item in `stryker.config.mjs` and design D3, alongside the two
      new deferred items this adoption produced (D7's static-mutant blind spot, and the 2.1
      burn-down)._

## 5. Gate

- [x] 5.1 `pnpm check` green; version decision: `chore`, no bump.
      _Amended for the v3.18.0 burn-down pass: it carries a real `fix` — the MusicBrainz
      album-title identity bug — so that pass ships as **3.18.1**. The mutation-gate work
      itself is still `test`/`chore` and demands no bump of its own._
