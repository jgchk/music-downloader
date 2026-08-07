# Tasks — mutation-gate-diff-scope

Sequencing: the pure model first (parser, overlap, verdict), then the entrypoint, then the CI
wiring, then the record corrections, then the measurement that gates enforcement. Every task
touching code is red-first: write the failing test, watch it fail, then make it pass.

Group 5 runs **after this change merges** — it collects data from real PRs, and it is the exit
criterion for enforcement. Enforcement itself is deliberately not in this change (design D3).

## 1. The verdict model — pure, red-first

- [ ] 1.1 Red: a `report-model.test.ts` scenario asserting the mutated span's **end** position is
      read, not just its start. Then extend `ReportedMutant.location` with `end: { line: number }`,
      require it in `isMutant`, and keep `VendorReportStaysAssignable` compiling against Stryker's
      own `schema.MutationTestResult`. Done when a report whose mutants carry no `end` is reported
      as unreadable rather than parsed with a silently narrowed span, and `summarize.ts` /
      `drift.ts` still pass unchanged.
- [ ] 1.2 Red: parser scenarios for `git diff -U0` hunk headers — `@@ -a,b +c,d @@`, the `+85`
      form where `d` is absent (exactly one line), the **`d == 0` pure-deletion** form (contributes
      no lines), several hunks in one file, several files in one diff, and a diff with no hunks at
      all. Then implement `scripts/mutation/changed-lines.ts` as a pure text → per-file line-range
      function. Done when the two `-U0` forms this repo actually emits are both covered by a named
      scenario and a pure deletion adds no gated line.
- [ ] 1.3 Red: overlap scenarios — a mutant wholly inside a changed hunk, a mutant whose span
      **encloses** the hunk (the whole-block case Stryker's containment filter would drop), a
      mutant abutting the hunk without touching it, and a mutant in a file with no hunks. Then
      implement the intersection predicate. Done when the enclosing case is a finding and the
      abutting case is not.
- [ ] 1.4 Red: path-join scenarios — a report keyed in one path spelling and hunks keyed in
      another normalise to the same repo-relative POSIX key, and a scope whose changed files match
      **no** file in the report is reported as *unaudited*, not as clean. Then implement the
      normalisation. Done when a deliberate spelling mismatch fails the verdict instead of
      producing an empty finding set (design D4, the silent-green hazard).
- [ ] 1.5 Red: verdict scenarios for all three failure conditions — a survivor overlapping a
      changed line; a missing report and an unreadable one; a scope where every mutant was
      `Ignored` and a scope with no mutants at all — plus per-line deduplication of the failing
      set (design D8) and the shadow/enforce distinction. Then implement `scripts/mutation/
      verdict.ts` as a pure function returning the verdict **as a value** (errors as values; no
      throws, no `process.exit` in the model). Reuse `readReport` and the counts `summarize.ts`
      already derives rather than reimplementing either. Done when each condition has its own
      named scenario and two survivors on one changed line produce one finding.

## 2. The entrypoint

- [ ] 2.1 Red: rendering scenarios — the blocking-finding table, the shadow banner that names the
      switch and says the job is not failing on this, and a distinct sentence for each of the three
      refusals (crashed / unreadable / audited nothing). Then implement the renderer beside the
      model, mirroring how `summarize.ts` presents `report-model.ts`. Done when a reader of the
      step summary can tell "clean", "shadow would have blocked", and "nothing was audited" apart.
- [ ] 2.2 Red: switch scenarios — unset, `false`, `0`, `true`, `1` — pinning that shadow is the
      default and that only an explicit enable enforces. Then implement `scripts/mutation/
      pr-verdict.ts` as the thin entrypoint (read report path + diff path, print Markdown, set
      `process.exitCode`), mirroring `report.ts` and `file-drift.ts`. Done when the same verdict
      computation yields exit 0 under shadow and exit 1 under enforce for identical input.

## 3. CI wiring

- [ ] 3.1 Export the merge-base the scope step already computes as a step output, and write
      `git diff -U0 "$BASE" HEAD -- <the in-scope files>` to a file in the same step. Done when the
      hunks and the mutate scope provably come from one merge-base — no second `git merge-base`
      call anywhere in the job.
- [ ] 3.2 Add the verdict step after the summary step: `if: always() && steps.scope.outputs.files
      != ''`, **no** `continue-on-error`, appending its Markdown to `$GITHUB_STEP_SUMMARY`, with
      the enforce switch absent (shadow). Done when a PR run shows the verdict in the summary and
      the job's conclusion is unchanged from today.
- [ ] 3.3 Rewrite the `continue-on-error` comment block on the Stryker step: state that the flag
      **moves rather than disappears** and why — that step's exit code stops being the verdict
      (design D5) — and delete the argument built on the retracted "464 → 6 (99.89%)" figure and
      its "four narrowing operands" (there are seventeen). Done when no comment in the workflow
      cites a number `mutation-gate`'s `design.md` retracts.
- [ ] 3.4 Raise `timeout-minutes` to 30 and replace `# projected low-minutes on a 4-core runner;
      NOT yet observed in CI` with the three measured runs (2m32s / 9m37s / 13m58s, the largest at
      66% of the old budget) and the reason a blocking job must not time out. Surface the Stryker
      step's duration in the job summary so variant (B)'s trigger is a number rather than an
      irritation (design D2/D6). Done when the comment states measurements, not projections.
- [ ] 3.5 Red: extend `test/boundaries/mutation-scope.test.ts` with the verdict step's own
      scenarios — the step exists and runs the entrypoint, it does **not** carry
      `continue-on-error`, and the enforce switch is absent (shadow is the shipped state). Keep the
      existing command-shape and scope-alternation pins working. Done when deleting the verdict
      step turns the boundary tier red, which is the property the existing scenarios were written
      for and would otherwise not cover.

## 4. Correct the record

- [ ] 4.1 Fix `scripts/mutation/report.ts`'s header comment: *"Never decides pass/fail — Stryker's
      exit code does that"* stops being true under this design. Done when the comment names which
      module decides and which one explains.
- [ ] 4.2 Restate `openspec/changes/mutation-gate/tasks.md`: drop 2.1's unreachable "(main becomes
      mutant-clean)" premise and close it on the triage being complete with its residue recorded;
      split 4.1 into 4.1a (enable enforcement once the measurement clears ten percent) and 4.1b
      (Jake: add the required check, in the same step), deleting the "split the four
      narrowing-operand lines" criterion. Done when no open task in that change depends on a state
      the research shows is unreachable (design D12).
- [ ] 4.3 Record the two missing CI measurements in `openspec/changes/mutation-gate/design.md`'s
      task-3.3 note (9m37s on 53 files, 13m58s on 36) and mark 2m31s as the smallest of three
      rather than the representative one. Done when the note no longer asks for a re-measurement
      that has already happened twice.
- [ ] 4.4 Fix `openspec/changes/mutation-gate/specs/mutation-testing/spec.md`: state each of the
      three duplicated requirements **once**, under ADDED, carrying the text that actually shipped,
      keeping the "restated during adoption" note as the section preamble. Done when
      `openspec validate --all --strict` is clean for both changes.

## 5. Measure — the exit criterion for enforcement (post-merge)

- [ ] 5.1 Collect the shadow verdict from every PR that changes production code in the mutated
      packages, for at least six such PRs. For each, record: findings the verdict would have
      blocked on, which of those a competent contributor would call genuine, which were ignored /
      waived without cause / appeased, the Stryker step's duration, and any disagreement between
      reruns of the same commit. Record the tally in this change's `design.md`.
- [ ] 5.2 Decide against `quality-gates.md`'s bar and record **both** possible outcomes honestly:
      under ten percent effective false positives → hand off to `mutation-gate` 4.1a/4.1b (flip the
      switch and the required check together, in one step); at or over → say so, leave the verdict
      in shadow, and name what would have to change first. A check can be worth running once
      without earning a seat.

## 6. Gate

- [ ] 6.1 `pnpm check` green (12 lanes); `openspec validate --all --strict` clean; version
      decision: `chore` — CI/tooling and artifacts only, no bump, no release.
