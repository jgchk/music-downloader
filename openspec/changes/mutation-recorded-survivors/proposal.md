# Proposal: mutation-recorded-survivors

## Why

The weekly full-repo mutation run has filed sixteen open `mutation-drift` issues (#168–#183)
covering thirty surviving mutants. Triaging all thirty found **no test gap**: every one is an
*equivalent mutant* — a change to production code that no test could ever distinguish, because it
produces the same observable behavior as the original.

Twenty-seven of them cannot be waived. The spec's site-level form,
`// Stryker disable next-line <mutator>: <reason>`, is granular to a **line and a mutator**, but the
equivalence is a property of a **single mutant**. At all twenty-seven sites the equivalent mutant
shares its line *and its mutator* with a sibling that is genuinely killable, so the only available
waiver would blind a real check. The repo already discovered this: fourteen sites carry a
hand-written `RECORDED SURVIVOR, waiver withheld:` comment explaining the equivalence and why the
waiver was not taken.

That leaves the gate in the shape its own doctrine names as the failure mode. `quality-gates.md`
asks that a rejected finding be "disabled once, with its reason — visible to everyone", and
`stryker.config.mjs` states the rule directly: **"a suppression the machine never reads is the one
that rots."** Fourteen prose comments are exactly that. Meanwhile the drift channel re-files the
same sixteen issues every Sunday, which is how a tracker channel stops being read — the precise
outcome the weekly job was designed to avoid.

Neither escape is available. Suppressing at line granularity blinds killable mutants. Reshaping the
production code to stop generating the equivalent mutant is the appeasement `testing.md` forbids —
"a lint rule that can only be satisfied by adding an unreachable branch has failed admission, not
the code."

The missing piece is a waiver whose granularity matches the finding's.

## What Changes

- **A third waiver form: the recorded survivor.** At the site, one comment naming the mutator *and
  the exact replacement text* it waives:

  ```ts
  // Stryker recorded-survivor ConditionalExpression `true`: <why no test can distinguish it>
  ```

  It reads like Stryker's own `disable next-line` and anchors the same way — to the line below it,
  so it travels with the code and cannot go stale by line drift. Unlike `disable next-line` it
  names the replacement, so it waives **one mutant** and leaves every sibling on the line observed.

- **The machine reads it.** `scripts/mutation/recorded-survivors.ts` parses the markers out of
  source and reclassifies the mutants they name from `Survived` to `Ignored` before the report
  reaches either consumer. The weekly drift channel and the PR verdict then agree, without either
  decider changing: `isSurviving`, `countMutants`, and `auditGap` already treat `Ignored` correctly.

- **A stale marker is a failure, not a shrug.** A marker that matches no surviving mutant in a file
  the run actually mutated means the waiver has outlived its argument — the code moved, or the
  mutant became killable. That fails loudly rather than lingering as a comment nobody rechecks,
  which is the property the prose comments never had. A marker waives exactly one mutant: if a line
  carries two matching survivors, it needs two markers.

- **The thirty survivors are resolved**, each by the honest rung rather than by reaching for the new
  mechanism first:
  - **Eight deleted as dead code** (rung 1). Both contexts' published-event mappings guard the
    correlation id with `isCorrelationId(story)` and then validate the same block against
    `publishedCorrelationSchema`, whose `correlationId` field applies the identical
    `CORRELATION_ID_PATTERN`. The guard cannot reject anything the schema would accept, so the
    schema becomes the single validator and the guard — with its four equivalent mutants per
    context — goes.
  - **Three waived at line granularity** where that is honest: the `case '<EventType>':` labels of
    the downloader's three no-op fold arms, where `StringLiteral` has no killable sibling on the
    line.
  - **Nineteen recorded** with the new marker, each carrying the argument for its equivalence. The
    fourteen existing `RECORDED SURVIVOR, waiver withheld` comments are converted in place: the
    reasoning was already written and reviewed; this change is what lets the machine act on it.

## Capabilities

- `mutation-testing` — the suppression requirement gains its third form and the staleness rule.

## Impact

- `scripts/mutation/` — one new module plus its tests; `file-drift.ts` and `pr-verdict.ts` apply it
  at their I/O boundary. `drift.ts`, `verdict.ts`, and `report-model.ts` are untouched: they keep
  deciding over a report, and the report they are handed is now the accurate one.
- `test/boundaries/mutation-scope.test.ts` — the waiver doctrine's scenario extends to the new form,
  so an unjustified recorded survivor fails the same way an unjustified `disable` does.
- Sixteen production files across both context packages: eight lines deleted, twenty-two marker
  comments added or converted. No behavior changes.
