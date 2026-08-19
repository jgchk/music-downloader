# Tasks — mutation-recorded-survivors

Sequencing: the mechanism lands before the sites that use it, so every marker added in §3 is
already read by the machine when it is written. §2 (deletions) is independent of the mechanism and
could land first; it is placed after so the whole survivor inventory moves in one reviewable step.

## 1. The mechanism

- [x] 1.1 `scripts/mutation/recorded-survivors.ts`: parse
      `` // Stryker recorded-survivor <mutator> `<replacement>`: <reason> `` out of a source text,
      anchored to the next line as `disable next-line` is. Red first: a marker with no reason, a
      marker whose replacement is unterminated, and a comment that merely mentions the phrase in
      prose are all NOT markers.
- [x] 1.2 Reclassify: given a report and a source reader, rewrite each matched mutant's status to
      `Ignored` (D5), leaving every other mutant untouched. A marker waives exactly one mutant
      (D3) — two matching survivors on a line need two markers.
- [x] 1.3 Staleness: a marker matching no survivor, in a file the report contains, is returned as a
      stale entry. Markers in files the report does not contain are not stale (D4).
- [x] 1.4 Apply it at both I/O shells — `file-drift.ts` and `pr-verdict.ts` — and exit non-zero with
      the stale marker named. `drift.ts`, `verdict.ts`, and `report-model.ts` stay untouched.
- [x] 1.5 `test/boundaries/mutation-scope.test.ts`: every recorded-survivor marker in the repo
      carries a reason, matching how the tier already holds the `disable` form.

## 2. Delete what the survivors proved redundant (D6)

- [x] 2.1 `packages/downloader/src/interfaces/contracts/events/mapping.ts`: drop the
      `isCorrelationId` guard and the `block === undefined` branch; `publishedCorrelationSchema`
      becomes the single validator. Four survivors go with the lines. Existing tests pin the
      behavior and SHALL keep passing unchanged — that they do is the proof the guard decided
      nothing.
- [x] 2.2 The same in `packages/importer/src/interfaces/contracts/events/mapping.ts` (four more).

## 3. Waive the rest on the honest rung

- [x] 3.1 Line waivers where they silence nothing killable (D7): the three no-op fold arms in
      `packages/downloader/src/domain/download/state.ts` (`StringLiteral` on the `case` labels).
- [x] 3.2 Convert the fourteen `RECORDED SURVIVOR, waiver withheld` comments to markers, keeping
      each argument and dropping the now-untrue "waiver withheld" clause.
- [x] 3.3 Record the remaining survivors that carry no comment yet, with the argument written:
      `duration.ts`, `importer/domain/import/decide.ts`, and the `metadata === undefined` and
      `entry.version <=` mutants that survive the §2 deletions.

## 4. Verify

- [ ] 4.1 Fresh full-repo `stryker run` (never `--incremental`, D4a of mutation-gate): every one of
      the thirty is Killed, Ignored, or gone, and no new survivor appeared.
- [ ] 4.2 `pnpm tsx scripts/mutation/file-drift.ts` over that report prints `[]`.
- [ ] 4.3 `pnpm check` green, including the tooling tier at 100%.
- [ ] 4.4 Close #168–#183 on the merge, each pointing at the resolution its file took.
