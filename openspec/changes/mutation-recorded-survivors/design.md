# Design — mutation-recorded-survivors

## Context

Thirty surviving mutants across sixteen files, filed as `mutation-drift` issues #168–#183 by the
weekly full run of 2026-08-09. Triaging all thirty (fresh full-repo run on `main` at 3.20.1,
2026-08-19, after the download-language rename moved two of the files) found **zero test gaps**.
Every survivor is an equivalent mutant, and twenty-seven of them share a line *and* a mutator with a
killable sibling, which is the whole problem: the waiver the spec offers is granular to a line and a
mutator, and the finding is granular to a mutant.

The dominant family is one shape, appearing at fourteen of the sites:

```ts
if (x !== undefined && f(x)) …        // the `x !== undefined` operand forced true
x === undefined ? undefined : g(x)    // the test forced false, so `g(undefined)` runs
if (state.phase !== 'P') return NOP;  // forced false, so a field only `P` declares reads undefined
```

The narrowing operand exists to make the expression *type-check*. Forced to its narrowing value, the
`undefined` it lets through reaches a call that ignores it, a comparison that is `NaN`-false, or a
field access that yields `undefined` again — so the program's behavior is unchanged and no test can
tell. The *other* mutants of the same mutator on the same line are real findings: the whole condition
forced the other way drops the feature entirely.

## Goals / Non-Goals

**Goals**

- A waiver whose granularity matches the finding's: one mutant, named by mutator and replacement.
- The waiver is read by the machine, so the drift channel and the PR verdict both act on it.
- A waiver that has outlived its argument fails loudly.
- The thirty open survivors resolved on the honest rung — delete first, line-waive second, record last.

**Non-Goals**

- No new Stryker plugin. The ignorer API (`shouldIgnore(path)`, 9.6.1) is node-granular and cannot
  see the mutator or the replacement, so it cannot express this waiver either — verified against the
  vendor's `IgnorerBookkeeper`, which resolves one message per *node* and applies it to every mutant
  generated from that node's subtree.
- No change to what counts as a survivor. `report-model.ts` keeps the survivorship policy; this
  change only makes the report it is handed accurate.
- No suppression of a mutant that any test could kill. Every marker states the proof.

## Decisions

### D1 — The marker is a comment at the site, anchored like Stryker's own

```ts
// Stryker recorded-survivor <MutatorName> `<replacement>`: <reason>
```

Alternatives considered and rejected:

- **A checked-in baseline file** (`mutation-survivors.json`, the classic mutation-baseline shape).
  Rejected: the argument for equivalence is about *this expression*, and a reader of the expression
  would never see it. It also needs a line number or a content hash to anchor, and both go stale on
  every edit around the site — which is how a baseline file becomes a list nobody rechecks.
- **Extending `// Stryker disable next-line`**. Rejected: that directive is the vendor's, parsed by
  the vendor's `DirectiveBookkeeper`. Overloading its syntax with a meaning Stryker does not
  implement would make a marker that reads as if Stryker honored it, when in fact Stryker still
  reports the mutant and only our tooling subtracts it.

Anchoring to the line below the comment is the same rule `disable next-line` uses, and it is what
makes the marker drift-proof: it moves with the code it argues about, so there is no line number to
maintain and no hash to invalidate.

### D2 — The replacement text is part of the key, and that is what buys the granularity

`ConditionalExpression` on `if (a !== undefined && b)` generates four mutants; the one that is
equivalent is identified by its replacement (`true`) and the killable ones by theirs (`false`). The
marker names both mutator and replacement, so it waives exactly the equivalent one.

Backticks delimit the replacement because replacements contain colons, parentheses, and quotes
(`"\"\""`, `story === undefined && !isCorrelationId(story)`); a colon-delimited grammar would need
escaping the moment it met a real replacement. Every replacement waived in this change is a single
line, and the parser requires that — a multi-line replacement would make the marker unreadable, and
none exists.

### D3 — A marker waives exactly one mutant

If a line carries two surviving mutants with the same mutator *and* the same replacement — different
nodes, identical text — it needs two markers. The alternative, "waive all matches", leaves a window
where a second mutant of the same shape appears later and is silently absorbed by a waiver written
for the first. Requiring one marker per mutant closes it: the count is asserted, so the second
survivor surfaces as an under-covered line rather than vanishing.

### D4 — Staleness is a failure, and it is only assertable where the run actually looked

A marker matching no survivor means the waiver has outlived its argument: the code changed, or the
mutant became killable. That must fail — the property the fourteen prose comments never had is that
something rechecks them.

But it can only be asserted for files the run **mutated**. A PR-scoped run mutates the changed files
and nothing else, so every marker elsewhere in the repo would look unmatched. The check is therefore
scoped to files present in the report, which is exactly right in both deployments: the weekly full
run sees every file and so rechecks every marker.

### D4a — A run that could not grade the mutant has no opinion on the waiver

Found by running it: the first verification run reported `ranking.ts`'s recorded mutant as `Timeout`
rather than `Survived`, because a test suite was running on the same machine. `Timeout` is a
*detected* status — the mutant hung the suite, which is a test noticing — so the waiver correctly did
not apply. But under D4 as first written, "did not apply" also meant "stale", and the weekly job
would have gone red over machine load.

So staleness distinguishes two ways a marker can match nothing:

- The mutant is **`Killed`**, or absent from the file entirely — a test now kills what the marker
  argued no test could, or the code moved out from under it. Stale, and the job fails.
- The mutant is **`Timeout`, `CompileError`, or `RuntimeError`** — the run could not grade it. The
  marker is neither applied nor blamed; this run has no opinion.

The distinction matters because the failure it prevents is the same one the whole channel is built
against: a red weekly job nobody believes is the drift channel going quiet by another route.

### D5 — Reclassify to `Ignored`, do not filter

The waived mutant is rewritten in the report with `status: 'Ignored'` rather than dropped from it.
`isSurviving` then excludes it, `countMutants` counts it in `ignored`, and `auditGap` can still tell
"nothing was audited here" from "everything here was clean" — a file whose every mutant is waived
reads as `all-ignored` and refuses, instead of reading as a clean bill. Filtering the mutants out
would have quietly converted the second case into the first, which is the failure shaped exactly
like success that the verdict's design (D4 there) exists to catch.

It also means neither decider changes. `drift.ts` and `verdict.ts` keep their logic; the I/O shells
(`file-drift.ts`, `pr-verdict.ts`) apply the reclassification when they read the report, which is
where reading source files belongs.

### D6 — Delete before waiving: the correlation guard

Both contexts' published-event mappings do this:

```ts
const story = cycleStart?.metadata.correlationId;
if (story === undefined || !isCorrelationId(story)) return undefined;   // ← 3 survivors
…
const checked = block === undefined ? undefined : publishedCorrelationSchema.safeParse(block);  // ← 1
```

`isCorrelationId` is `CORRELATION_ID_PATTERN.test(value)`, and `publishedCorrelationSchema`'s
`correlationId` is `z.string().regex(CORRELATION_ID_PATTERN)` — the same regex, imported from the
same module. The guard cannot reject a story the schema would accept, and the schema's failure path
already drops the block. So the guard decides nothing, and rung 1 of the coverage ladder applies:
delete it.

What the guard was *documented* to guarantee — "never fabricated: a cycle whose rows predate the
capability yields no block at all" — is unchanged, and now has one enforcer instead of two. The
comment already argued the schema check must stay, so that no rename in `correlationOf` could
silently detach every trace; making it the sole validator is the same argument carried through.
Eight equivalent mutants go with the deleted lines, and the four killable siblings that went with
them were only killable because the redundant lines existed.

### D7 — Line waivers where they are honest

The downloader's fold has three arms that return `state` unchanged. Mutating their `case` label to
`case ''` makes the event miss every arm and fall to the switch's trailing `return state` — the same
answer. `StringLiteral` is the only mutator generating a mutant on those lines, so
`// Stryker disable next-line StringLiteral` waives the equivalent mutant and nothing else. The new
mechanism is not reached for where the old one is exact.

## Risks

- **A wrong equivalence claim blinds the gate permanently.** Mitigated by requiring the proof in the
  marker (reviewed like an `any`), by D3's exact count, and by D4's staleness failure — but the
  claim itself is a human judgement and stays one. This is why the marker is verbose by design: a
  reason that cannot be written is a mutant that should be killed instead.
- **The marker becomes the path of least resistance.** A rising recorded-survivor count is the same
  anti-signal `quality-gates.md` names for suppressions. The count is small and every entry is in
  one grep; a future change that adds many at once should be read as the rule failing admission.
