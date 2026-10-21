# Design — mutation-gate-diff-scope

## Context

See `proposal.md` — Why. The evidence base is `docs/research/blocking-mutation-gate-scope.md`
(2026-08-07), which verified the house facts against `main` and the tool facts against
StrykerJS's own source, docs and tracker. This document does **not** re-argue that research; it
records which of its options were taken, and why the rejected ones were rejected. Section
references below (§n) are to that document.

What exists today, and constrains the approach:

- `.github/workflows/pipeline.yml` job `mutation`: PR-only, `timeout-minutes: 20`, a scope step
  resolving changed production files via `git merge-base` + `git diff --name-only`, then
  `pnpm exec stryker run --mutate "$MUTATE"` under `continue-on-error: true`, then an
  `if: always()` step writing `scripts/mutation/report.ts` to the step summary.
- `stryker.config.mjs` sets `thresholds.break: 100` — literally "zero survivors among
  non-ignored mutants", not a percentage in any meaningful sense (§2.5) — and writes its JSON to
  `reports/mutation/mutation.json`.
- `scripts/mutation/report-model.ts` is the one tolerant reader over that JSON. It already
  models all three "no report" cases (absent, unparseable, wrong shape) as `undefined`, and
  `summarize.ts` already detects and describes the all-ignored scope. `file-drift.ts` already
  refuses to report zero drift from an unreadable report.
- `test/boundaries/mutation-scope.test.ts` pins the job's command shape, the scope alternation,
  the report path, the waiver doctrine and the suppression ceiling.
- Main is not mutant-clean: **7100 mutants, 929 ignored, 6083 killed, 61 timed out, 27 surviving
  — 99.56%** at the tip. All 27 are provably equivalent and deliberately left unwaived, because no
  mechanism Stryker 9.6.1 offers is (node AND mutator), so every available waiver for this family
  silences a killable twin. (An earlier reading of this same tip said 64 at 98.96%, of which 45
  arrived with one unrelated feature inside a week and 2 were a real unspecified-behaviour finding
  in the MusicBrainz album path. The 45 were burned down to 9 and the MusicBrainz finding was FIXED
  in v3.18.1 — it was a domain bug, not a mutant to appease. Mutation debt is a flow, not a stock:
  that is the point, not a caveat.)

## Goals / Non-Goals

**Goals**

- Make the *failure* scope the changed lines while the *reporting* scope stays the changed files.
- Move the verdict off the mutation runner's exit code onto a step that owns it, and make that
  step fail closed.
- Ship the verdict in shadow, with one switch to enforcement and a measurement gating it.
- Leave the record honest: fix the drift the research found, and restate the two tasks whose
  premise this change supersedes.

**Non-Goals**

- **Enabling enforcement.** The switch ships off. Flipping it is a separate decision on separate
  evidence.
- **The `ignore-unions` ignorer plugin.** Named in `proposal.md` as out of scope with its reason —
  and with the measurement that now argues against building it at all. (The two MusicBrainz
  survivors were also listed here as out of scope; they were **fixed in v3.18.1**, so there is
  nothing left to be out of scope about.)
- **Any change to what Stryker mutates or how.** No mutator changes, no new suppressions, no
  threshold change. `thresholds.break: 100` stays exactly as it is (§6: keep it while it means
  "zero survivors"; never introduce a sub-100 number).
- **Wall-clock reduction.** Variant (A) buys none, deliberately (D2). The lever is recorded, not
  pulled.

## Decisions

### D1 — Failure scope is the changed lines; reporting scope stays the changed files

The shipped file scope was justified in the job's own comment by an identity: *"once main is
mutant-clean, a changed file's untouched lines carry no survivors, so the two give the same
verdict."* Main is not mutant-clean and §5 establishes it cannot become so by any mechanism
currently shipped — equivalence is undecidable, StrykerJS has no per-mutant suppression, and the
one mechanism that would work is an unwritten deferred item. With the precondition unavailable,
"stricter and far simpler" reduces to "stricter": it fails branches for debt they did not create.

Line-scoped failure is the attested shape, independently, in three fields (§3): mutation testing
(Google's *"Only lines affected by the diff under review that are covered and are not arid are
mutated"*; arcmutate's default `scope: line`, widenable to `class` as an explicit opt-in; Mull;
Cosmic Ray), coverage (Sonar's Clean as You Code, Codecov's `patch` status, diff-cover,
undercover) and static analysis (golangci-lint's `new-from-merge-base`, with `whole-files` as the
*widening*). Everywhere the granularity is stated, **line is the default and file is the
deliberate widening.** Line scope was also this capability's own drafted requirement, amended to
files during adoption to match the code.

Reporting stays wide because narrowing it would throw away information for nothing. Android
lint's design is the transferable one (§4): baselines *"are enabled when you run inspections in
batch mode… but they are ignored for the in-editor checks"* — **suppress the gate, never the
feedback.** A wide report under a narrow gate also preserves the one genuine property file scope
had: an assertion weakened elsewhere in a file the branch touched still shows up, as a report
rather than as a block.

**Consequence, stated rather than discovered:** the twenty-seven recorded equivalents stop
blocking the moment the failure scope stops including untouched lines
— without being suppressed, and without silencing the killable twins that share their lines. When
a PR *does* edit one of those lines, being asked to re-audit the equivalence claim is correct
behaviour, not friction. That is exactly what Sonar sells: *"You own the quality and security of
the new code you are working on today."*

### D2 — Variant (A): post-filter a file-scoped run, not (B) range-scope the run

Two ways to implement D1 (§9):

- **(A)** Keep `--mutate <changed files>` exactly as today; add a verdict step that reads
  `reports/mutation/mutation.json` and fails only on survivors overlapping a changed hunk.
- **(B)** Pass `--mutate 'path:start-end,path:start-end,…'` built from the hunks and let
  Stryker's `break: 100` be the verdict, deleting `continue-on-error` outright.

(B) is cheaper, simpler, and needs no new verdict code — and it is native and maintainer-endorsed:
mutation ranges shipped in **v4.6.0**, and nicojs recommends exactly this for diff gating
(*"stryker run --mutate foo.js:25-30. This can be combined with some kind of pipeline git diff
command"*), having deliberately refused to build git in (*"I wouldn't want to use git as a source
of files"*). A comma-separated list of explicit `path:start-end` entries is valid; only mixing a
range with a *glob* in one array element is rejected.

**(A) is taken anyway, for one reason that (B) cannot supply at all.** Stryker's range filtering
is **containment**: `babel-transformer.ts`'s `shouldMutate` requires `locationIncluded(range,
node.loc)`, so a mutant whose node is larger than the range is never generated. A
`BlockStatement` mutant spanning a whole function is therefore **not produced** when only one line
inside it changed. In Google's data `SBR` (statement block removal) is **72.18%** of all mutants
and *"the mutation type second-least likely to survive"* — the biggest and bluntest family, and
the one most likely to be a real finding. (A) filters after the fact, so the intersection test can
use **overlap** instead, recovering precisely what (B) drops.

(A) also keeps the full file-scoped inventory in the step summary, which D1 wants.

**The cost is honest and it is the whole cost:** (A) buys no wall-clock saving. The 13m16s
Stryker step on a 36-file diff stands. That is D6 and D7's problem, not a hidden one.

**(B) is the recorded tuning lever, not a rejected option.** Take it the first time a PR's Stryker
step exceeds ~15 minutes, accepting two consolations: the changed-line findings — the ones the
gate actually blocks on — are unaffected, and the weekly full run already exists as the wide
channel for everything (B) stops seeing at diff time. What (B) loses is the *timeliness* of the
file-wide signal, not the signal. To make the switch a number rather than an irritation, the
Stryker step's duration is surfaced in the job summary (task 3.4).

### D3 — Shadow mode is the shipped first state, and the switch is a flag

`quality-gates.md` admits a check only **"under ten percent effective false positives, measured on
*this* repository, not on the check's reputation elsewhere"**, where anything the loop ignores,
waives without cause, or appeases counts as false. Nothing here has been measured against that
bar in the *blocking* configuration, and the reference points are not comfortable:

- Google's mutant productivity — the complement of their "Not useful" rate — is **82% aggregate,
  80→89% over time, against a stated ~90% target**, with a policy of disabling a mutator on any
  node type that drops below 80%. That is the industry-best number after years of tuning across
  seven languages and 140 arid rules, and it sits *at* this repo's bar rather than inside it.
- **Google's release valve is a human clicking "Not useful."** This factory has no such human. §9
  names this as the gap that most needs measuring: there is no evidence at all about what an
  agent loop does with the residual 11–18% under a *blocking* gate.

So the verdict computes and publishes, and does not fail. Enforcement is one environment switch
(`MUTATION_GATE_ENFORCE`), read at the entrypoint, changing the exit code and nothing else — so
the shadow measurement is a measurement of the *enforcing* logic, not of a different program.
This is the method `docs/research/result-lint-and-tier-enforcement.md` used before adopting a lint
rule: count the violations against this repo first.

**Alternative rejected — ship enforcing and back it out if noisy.** A blocking check that turns
out noisy has already taught the loop to appease it, and appeasement is not recoverable by
reverting the flag: the fiction tests remain. `quality-gates.md` is explicit that an agent which
cannot ignore a noisy finding will write one.

**Alternative rejected — a warning-level check (arcmutate's default).** `quality-gates.md`: *"A
blanket severity downgrade is not a carve-out. A warning nobody blocks on is the attested-dead
nightly-batch shape. A rule is `error` or it is off."* Shadow mode is not that: it is a
time-boxed measurement with a named exit criterion, not a permanent severity.

### D4 — The verdict fails on three conditions, reusing what already models them

Once enforcing, the verdict step fails on:

1. a surviving mutant whose span overlaps a changed hunk;
2. a **missing or unreadable** report;
3. a resolved scope in which **no mutant was actually analysed** — all ignored, or none
   generated.

Conditions 2 and 3 exist because the alternative is a gate that greens on its own breakage, which
is the one failure mode this job must not have — the same reasoning already written into the scope
step's `match()` helper, into `file-drift.ts`'s refusal to report zero drift from an unreadable
report, and into `summarize.ts`'s refusal to print "no surviving mutants" over a scope it did not
audit. None of this is new machinery: `report-model.ts`'s `readReport` already returns `undefined`
for absent, unparseable and wrong-shaped reports, and `summarizeSurvivors` already distinguishes
"no mutants at all" from "every mutant ignored" from "clean". The verdict *acts* on what they
already *detect*.

**A fourth failure mode, folded into condition 3 rather than named separately.** Stryker keys its
report `files` by its own path spelling; the changed hunks come from git. If those two spellings
disagree, every intersection test returns false and the gate is vacuously, permanently green — the
most dangerous outcome available, because it looks like success. The join therefore normalises
both sides to repo-relative POSIX paths, and a resolved scope whose changed files match no file in
the report is treated as "nothing was audited" (condition 3), not as "nothing was found". Task 1.4
pins this with a test, and task 5.1's first shadow run verifies it against a real report.

### D5 — `continue-on-error` moves; it does not disappear

Under (A) the flag stays on the Stryker step, and the artifacts must say so plainly rather than
describe a removal. The reason is not caution — it is that **the Stryker step's exit code stops
being the verdict**. `thresholds.break: 100` makes Stryker exit 1 for any survivor anywhere in the
file-wide reporting scope, which is exactly the verdict D1 rejects. The job's decision moves to the
new step, which does **not** carry the flag.

Two things follow that are easy to get wrong:

- The verdict step must run even when Stryker failed, so it is `if: always()`-shaped like the
  summary step — otherwise a crashed run skips the step that was supposed to fail on a crashed
  run.
- Under (B) this inverts: `continue-on-error` would be deleted outright and `break: 100` would be
  the verdict again. That is a genuine argument for (B) and is recorded with the lever in D2.

### D6 — Raise `timeout-minutes` 20 → 30, and replace the stale comment with the measurements

The comment says `# projected low-minutes on a 4-core runner; NOT yet observed in CI`. It has been
observed three times (§1), read from the Actions API:

| PR | changed prod files | Stryker step | whole job |
| --- | --- | --- | --- |
| `mutation-gate`'s own (#161) | 2 | 1m43s | 2m32s |
| v3.18.0 correlation | 53 | 8m54s | 9m37s |
| the burn-down | 36 | **13m16s** | **13m58s** |

13m16s is **66% of the current budget**, leaving 6m44s of headroom, and cost is **not** linear in
file count — it is mutants × tests per mutant, so the burn-down's 36 densely-covered domain files
cost more than the correlation change's 53. Today a timeout is invisible (`continue-on-error`).
Once enforcing, a timeout is a **red required check on a correct branch**: unattributable,
non-deterministically reproducible, and precisely the thing that teaches an agent loop that the
mutation check is the flaky one. Raising the timeout is free and should be done regardless of when
enforcement lands; `release` already sits at a comparable order.

The other levers, in the order `mutation-gate` D4 already names them, remain: `--concurrency`
first, then narrowing scope (which is D2's variant (B)), then larger runners, which cost money.

### D7 — Record the merge-latency consequence: ~2 min → ~14 min, a 7× increase

Sibling jobs on the same run: `quality` 1m16s, `test` 2m04s, `version-check` 19s. Requiring the
mutation check moves the PR critical path to the mutation job's duration — ~14 minutes at the
largest measured diff. `quality-gates.md`'s latency budget explicitly exempts CI from the
seconds-order rule, so this violates no non-negotiable, and Google's own framing (~2% overhead,
run *off-peak*) does not apply to a job on the merge path. But it is the largest single cost of
the flip and it is currently written down nowhere. It is written down here so the flip is a
decision rather than a discovery. Under (B) it largely goes away — a second reason the lever
exists.

### D8 — The verdict names at most one finding per changed line

`summarize.ts` already applies Google's one-mutant-per-line **surfacing** rule, and TSE 2021
confirms it empirically: *"In more than 90% of the cases, either all mutants in a line are killed,
or all mutants in a line survive."* But the verdict as designed would count every survivor, so one
weak line can present as a dozen blocking findings. Google caps the surfaced set at a **median of
7 per changelist**; this gate has no cap at all, and §9 flags "a gate with no per-changelist cap"
as unattested at any volume. Deduplicating the *failing* set per line costs nothing and makes the
finding count honest. It is included here rather than deferred because it is part of the same
verdict computation and would otherwise be a second pass over the same data.

No per-PR cap is introduced: a cap that hides findings from a blocking gate would make the gate
lie about what it wants. The volume question is instead something the shadow measurement (task
5.1) is expected to answer with numbers.

### D9 — Parse `git diff -U0` hunk headers carefully; the diff is data, not a subprocess

The changed lines come from `git diff -U0 "$BASE" HEAD -- <in-scope files>` against the **same**
merge-base the scope step resolves, exported as a step output so the two cannot drift onto
different bases. The workflow writes the diff to a file and the entrypoint reads it; the parser
itself takes text and returns ranges, so it is a pure function with tests rather than a shell-out
buried in a script.

Two parsing rules the research verified against a real diff in this repo, both of which produce a
*wrong gate* rather than a crash if got wrong:

- `@@ -a,b +c,d @@` with `d` **absent** means exactly one line (`-U0` emits both the `+85` and
  `+44,25` forms).
- **`d == 0` means a pure deletion** and adds no lines to mutate. Turning it into the range `c-c`
  would gate the branch on a line it never touched.

Deletions are already dropped from the mutate scope by `--diff-filter=ACMR`; this is the same rule
one level down, at the hunk.

### D10 — Alternatives rejected, with the reason in one line each

These were the other four options on the research's table (§4, §5, §6, §2.4). Each is genuinely
recognised prior art; each is wrong *here*, and the reasons are summarised rather than re-argued.

- **A committed accepted-survivor baseline** (the PHPStan / Psalm / ESLint-bulk-suppressions /
  Android-lint / betterer pattern). Recognised and well documented — including by its own
  authors' candour about its failure modes: PHPStan's *"The life goal of a baseline file is to not
  exist"*, ESLint's admission that once a count moves *"there's no reliable way to determine
  whether the new violations were introduced recently or already existed"*, Android lint's warning
  that a fixed issue silently returns. Rejected for three reasons: (a) it is **redundant** with
  diff scoping, which computes the same boundary from VCS with no artefact to rot,
  merge-conflict, or regenerate — a baseline *is* an implementation of diff scoping, not an
  alternative to it; (b) the 17 are not homogeneous legacy debt but a **structural class** that
  new code in the same style keeps regenerating, and enumerating instances of a class is the
  anti-pattern `quality-gates.md` already names; (c) **a ratchet the constrained party can
  regenerate is a rubber stamp**, and in an agent loop the constrained party *is* the party that
  edits the file. If one is ever built anyway: key on `(file, location, mutatorName, replacement)`
  — never on Stryker's mutant `id`, which is a per-run ordinal — require a reason per entry, and
  make growing it harder than shrinking it, which is the one consistent design consensus across
  every mature baseline tool.
- **Refactoring the equivalents onto their own lines** so their waivers become precise. Ruled out
  by evidence already in `mutation-gate`'s `design.md`: `ConditionalExpression` emits `true` *and*
  `false` from one node and `EqualityOperator` emits both substitutions from one operator token,
  so the equivalent and its killable twin are co-located **whatever the formatting**. No line
  split can separate them. Attempting it anyway would be contorting production code to satisfy a
  tool — the appeasement the admission contract exists to prevent. This is also why
  `mutation-gate` task 4.1 cannot close as written (D12).
- **A percentage `thresholds.break`.** Unsound on a scoped run, and rejected by four independent
  arguments: the denominator moves with the diff (372 mutants on a 2-file PR, thousands on a
  large one), so a fixed percentage makes the gate's strictness *inversely* proportional to the
  size of the change; Google could compute a mutation score and explicitly chose not to
  (*"unable to find a good way to surface it to the engineers in an actionable way"*, and *"living
  mutants… alone do not make a good measure of efficacy"*); mutation *scores* correlate weakly with
  real fault detection once suite size is controlled, even though mutation *testing* earns its
  place (Papadakis et al., ICSE 2018); and this repo has already produced a score of **99.89% that
  was false** while 96 mutants sat silenced by a suppression that never ended. A percentage is the
  shape that made that invisible. Keep `break: 100`, which at 100 is "zero survivors", not a
  percentage; introduce no sub-100 number.
- **`--incremental` against a main baseline.** Already rejected by `mutation-gate` D4a for the
  right reason — Stryker's incremental report is **whole-repo**, so the break threshold applies to
  the merged whole and a branch fails on files it never touched, converting a diff gate back into
  a repo gate. Two additions from the research: the docs do **not** state whether `thresholds.break`
  applies to the merged whole, so D4a's claim stands on this repo's own measurement and should
  stay labelled as measured-here, not attested; and the incremental file is **not committable**
  with the vitest runner at all — issue #6004, open against the pinned 9.6.1, reports
  non-deterministic vitest test IDs producing a ~15k-line diff on every no-op run, which its
  reporter calls *"a blocker for storing the incremental baseline in version control."*

### D11 — Corrections to the record this change is obliged to make

The research's §10 lists documentation drift found while verifying the house facts. Fixing it is
part of this change because three of the five items are the *stated rationale* for behaviour this
change alters, and leaving a retracted figure arguing for a decision is how the next reader
relitigates it:

1. **The job's `continue-on-error` comment argues from a retracted number.** It cites *"464
   survivors to 6 (99.89%)"*, *"the 6 sit in…"*, and *"Four are provably equivalent narrowing
   operands"*. `design.md` explicitly retracts that: run 6's 99.89% was false (it was hiding 104
   killable mutants behind two block directives that never closed), corrected to 19 at 99.67%, and
   the tip of main is **27 at 99.56%**. The comment is rewritten around D5's actual reason.
2. **The stale timeout comment** (D6).
3. **`design.md`'s task 3.3 / Open Questions** records 2m31s on a 2-file diff and asks for a
   re-measurement on the first PR that changes production code. Two such PRs have since run;
   neither is recorded, and 2m31s now reads as representative when it is the smallest of three.
4. **Task 4.1's exit criterion is unreachable as written** — D12.
5. **The spec delta lists three requirements under both MODIFIED and ADDED**, which fails
   `openspec validate --strict`. Since `mutation-testing` is a *new* capability that has not been
   archived into `openspec/specs/`, the honest form is one statement of each requirement under
   ADDED carrying the text that actually shipped, with the "restated during adoption" note kept as
   the section's preamble. Cheap, and it makes this change's own MODIFIED delta well-formed.

### D12 — `mutation-gate` tasks 2.1 and 4.1 are restated, because this change supersedes their premise

**Task 2.1 — "Seeding triage (main becomes mutant-clean)".** The parenthetical is not achievable.
§5.1 is unambiguous: the equivalent fraction among *survivors* **rises** as the suite improves
(Schuler & Zeller: *"The percentage of equivalent mutants increases as the test suite improves"*,
with the arithmetic — *"A perfect test suite would detect all non-equivalent mutants; hence, 100%
of undetected mutants would be equivalent"*); 7–40% of all mutants are equivalent across the
historical range; under 5% of mutants are subsuming at all; and classifying a single equivalent
costs 4.6–15 minutes of human-or-agent judgement. Twenty-seven unkillable survivors after a
464 → 19 → 27 burn-down is the literature's **predicted outcome**, not a residue of incomplete work. Restated:
2.1 closes on *the triage being complete with its residue recorded*, which it is, and its heading
loses the unreachable parenthetical. Under line scope the recorded equivalents stop blocking
without being suppressed, so nothing has to be done to them before a flip.

**Task 4.1 — the required-check flip.** Its stated exit criterion is *"split the four
narrowing-operand lines so their waivers become precise"*. That is doubly superseded by
`mutation-gate`'s own `design.md`: there are **seventeen** of that mutator family, not four (and
**twenty-seven** survivors in all), and **splitting cannot work**
for this mutator family (D10, second bullet). The task can never close as written. Restated as the
two-step it now is, with the criterion this change makes reachable:

- **4.1a** — enable enforcement (`MUTATION_GATE_ENFORCE`) once the shadow measurement clears the
  ten-percent effective-false-positive bar on real PRs here.
- **4.1b (Jake)** — add the check to the main-branch ruleset's required checks, together with
  4.1a, in one step. Repo settings are outside agent permissions.

The old "once main is mutant-clean" precondition is deleted, not weakened: it names a state that
does not exist.

## Risks / Trade-offs

- **Blocking at all is unattested — carry it forward, do not quietly drop it.** `mutation-gate` D2
  flagged blocking as a deliberate deviation from Google's advisory deployment, and the research
  confirms the deviation is real and larger than D2 assumed. Google never blocked: TSE 2021 §2.4
  settles it in one sentence — *"These findings do not need to be resolved by the author before
  submission, unless a human reviewer marks them as mandatory."* Blocking, where it exists at all,
  is a **human** decision on a specific finding, never the tool's. arcmutate's GitHub integration
  defaults to *warning*. **No peer-reviewed deployment of a blocking mutation gate was found in a
  deliberate sweep.** The argument for blocking here — no human to shrug, and an advisory channel
  with no consumer is the attested-dead shape, now *observed* on this repository in v3.18.0's 45
  unconsumed survivors — is sound reasoning by analogy, but it is analogy, not evidence. → This is
  the risk shadow mode exists to convert into a number (D3). D2's compensations (scope narrower
  than Google's, a seeded arid list) are only half delivered while scope is *wider* than Google's;
  D1 delivers the other half.
- **A 100% break threshold on a codebase with known-unkillable mutants is also unattested.** No
  source gates a mutation run at zero survivors, and Google calls adequacy *"neither practical nor
  desirable"*. → Defensible only in proportion to how narrow the scope is: adequacy over the lines
  you wrote is what "you own the new code" means everywhere in §3.3, where adequacy over every
  line of every file you touched is not. D1 is what makes `break: 100` defensible, and the two
  should be read together.
- **A gate with no per-changelist finding cap is unattested at any volume.** → D8 caps per line;
  the per-PR volume is left to the shadow measurement rather than guessed at.
- **Verdict stability across reruns is unmeasured.** `report-model.ts` treats `Timeout` as
  detected, so a loaded runner turning a `Killed` into a `Timeout` is safe — but a mutant killed
  only by a timing-sensitive test is not, and nothing in the repo measures mutation-verdict
  stability across reruns. Once the check blocks, that number matters. → Task 5.1 records rerun
  disagreements alongside the false-positive count; a flaky blocking check is worse than no check.
- **(A) buys no wall-clock, and a blocking job that times out is the worst failure available.** →
  D6 raises the timeout; D2 records (B) as the lever and task 3.4 surfaces the duration so the
  switch is triggered by a number.
- **The path-spelling join is a silent-green hazard.** → D4's fourth mode, folded into condition 3
  and pinned by a test.
- **Shadow mode is itself the attested-dead shape if it never ends.** A verdict nothing blocks on
  is a warning nobody blocks on. → It is time-boxed by task 5.1's named exit criterion, and the
  measurement is a deliverable, not an intention. If the measurement says the configuration cannot
  clear ten percent, the honest outcome is to *say so and not flip* — `quality-gates.md`'s "a
  check can be worth running once without earning a seat" applies, and both halves get recorded.

## Migration Plan

Ships as one change, artifacts and tooling only — no runtime surface, no version bump. The job
keeps reporting exactly as it does today; the only observable difference on a PR is an extra
step that prints a verdict it does not act on. Rollback is deleting the verdict step and its
module.

Enforcement is *not* migrated here. Task 5.1 collects the measurement; `mutation-gate` 4.1a/4.1b
flip enforcement and the required check together, in one step, so the gate never spends time in
the "fails but is not required" shape `quality-gates.md` rejects.

## The verdict watched deciding, on real data

Written before the first CI run, because a gate nobody has watched decide anything is written rather
than implemented — and because the one hazard that matters most here (D4's path-spelling join) is
invisible in unit tests built from our own fixtures: they would agree with each other whatever
Stryker does.

Two real Stryker runs on the shipped tree, and three real `git diff -U0 --no-prefix` outputs.

**The join, verified against a real report rather than a fixture.** Stryker 9.6.1 keys its report
`packages/downloader/src/domain/ranking/ranking.ts` — repo-relative, POSIX, byte-identical to what
`git diff --no-prefix` prints. This matches its source (`normalizeReportFileName` is
`normalizeFileName(path.relative(process.cwd(), fileName))`), now confirmed by observation. The
report also carries genuine multi-line spans: 31 of `facade/mapping.ts`'s mutants span more than
five lines, which is the family the overlap test exists for.

**The decision, both directions.** `packages/importer/src/facade/mapping.ts` has one real surviving
mutant — `ConditionalExpression` → `false` at line 51, the equivalent already recorded in
`mutation-gate`'s survivor table. Stryker exited **1** on that run, as `thresholds.break: 100`
demands.

| the branch's diff                            | verdict                     | shadow exit | enforcing exit |
| -------------------------------------------- | --------------------------- | ----------- | -------------- |
| edits line **51** (the survivor's)           | `findings` — 1, named       | 0           | 1              |
| edits line **200**, 149 lines away           | `clean`                     | 0           | 0              |
| line 200, diff cut **without** `--no-prefix` | `unaudited: no-file-joined` | 0           | 1              |
| the diff file was never written              | `unaudited: no-diff`        | 0           | 1              |
| line 51, report absent (crashed run)         | `no-report`                 | 0           | 1              |

The second row is the whole thesis in one line: **Stryker exited 1 and the verdict is clean.** Under
the shipped file scope that exit code was the gate, so a branch editing an unrelated line of that
file went red for a survivor it did not create. Under changed-line scope the survivor is still
*reported* — the summary says "1 surviving mutant elsewhere in the changed files … did not block this
branch" — and blocks nothing.

The third row is the silent-green hazard, produced on purpose by dropping one flag. It fails as
*unaudited*, names the cause, and **lists the offending path** rather than reporting a clean scope —
the outcome that would otherwise have looked exactly like success forever. The fourth is its near
neighbour, and it used to be told the same story: a diff the job never wrote once rendered the
path-drift paragraph, sending a reader to debug a normalisation bug that does not exist. It now has
its own refusal and its own sentence.

**What this does NOT verify.** The workflow wiring. This change alters no production file in the
mutated packages, so its own PR resolved an empty scope and skipped the verdict step entirely —
correctly, and confirmed in the job's step list. Everything above exercised the modules directly.
The first PR to touch `packages/*/src` is where `RUNNER_TEMP`, the step outputs and the env are
exercised for the first time, and it is the run to read carefully.

## Known false-positive sources, for the shadow measurement to price

Review found three ways this verdict can block a branch that did nothing wrong. None is fixed here,
deliberately: shadow mode exists to measure exactly this, and guessing at a remedy before the data
is the appeasement the admission contract warns about. Task 5.1 counts each one.

- **A pure rename gates the whole moved file.** The job cuts the diff with a pathspec limited to the
  in-scope files, which defeats git's rename pairing — so the destination is emitted as a whole-file
  add, every line enters the failure scope, and every pre-existing survivor in the moved file becomes
  a blocking finding on a branch that changed no behaviour. This is the "fails a branch for debt it
  did not create" shape D1 rejects, arriving by a path D1 did not anticipate. Candidate remedies, if
  the measurement says it matters: `--no-renames` in `DIFF_FLAGS`, or resolving hunks against the
  pre-rename path.
- **A scope in which every mutant errored reads as audited.** `auditGap` refuses a scope with no
  mutants and one where all are `Ignored`, but `CompileError` / `RuntimeError` / `Pending` mutants
  are neither surviving nor ignored, so a scope in which every mutant failed to compile passes the
  refusal and returns `clean`. Reachable on a small, type-heavy diff. The fix is a fourth reason
  keyed on the count of mutants actually *tested*, and it is a behaviour change to a refusal, which
  is precisely the kind of thing to make on evidence.
- **Reruns are unmeasured.** `report-model.ts` counts `Timeout` as detected, so a loaded runner
  turning a `Killed` into a `Timeout` is safe — but a mutant killed only by a timing-sensitive test
  is not, and nothing measures verdict stability across reruns of one commit. Task 5.1 records rerun
  disagreements; a flaky blocking check is worse than no check.

Two more findings are recorded as deliberate non-goals rather than risks. The shadow verdict is
readable only in the step summary and the job log — there is no annotation, artifact or aggregation,
so task 5.1's collection is manual by construction; and `pr-verdict.ts` remains the only module in
`scripts/mutation/` whose coverage the tooling tier cannot see, because it is exercised as a
subprocess.

## Open Questions

- **How many shadow PRs are enough?** Task 5.1 sets a floor of six PRs that change production
  code, on the reasoning that the false-positive rate to be estimated is around 10% and fewer
  samples cannot distinguish 0 from 20. If the first six produce zero findings, the answer is that
  the sample is uninformative rather than that the rate is zero — collect until the shadow verdict
  has fired at least a handful of times. This can be settled with the data in hand and does not
  change the specs, the approach, or the task breakdown.

## The measurement (task 5.1): a replay backtest over eight merged PRs

### What this is, and what it is not

No live PR touched `packages/*/src` while the shadow gate was wired, so the verdict step has still
never executed in CI (task 3.2's note stands). The measurement below is a **replay backtest**: for
each PR, its head commit was checked out, the changed production files were resolved against its own
merge-base by re-running the job's `scope` step verbatim, Stryker was run scoped to exactly those
files, and **today's** `verdict.ts` was applied to that report plus that PR's
`git diff -U0 --no-prefix --diff-filter=ACMR` output. The inputs are real diffs, real code, real
tests and real Stryker reports.

It is **not** live shadow observation, and three limits follow. The workflow wiring — `RUNNER_TEMP`,
the step outputs, the env — is still unexercised, because the replay called the modules directly.
Author behaviour is unobservable: this grades whether a finding *could* have been closed, not what a
contributor actually did when shown it. And the sample is retrospective, so it cannot show the loop
learning to appease a gate it knows is blocking — the failure mode the ten-percent bar exists to
prevent is precisely the one a backtest cannot see.

### Scope resolution, including the PRs that resolve to nothing

Ten recently merged PRs were considered. Two resolve an **empty scope** by design and were skipped,
not silently dropped: **#151** (`feat(web)`) touches only `packages/web`, which
`stryker.config.mjs` excludes; **#157** (`test(properties)`) touches only test files, which the
scope step's `.test.ts` filter removes. Both would skip the Stryker, summary and verdict steps
exactly as #166 did.

**Four replays required a graft, and it is declared.** StrykerJS entered the repo in **#161**, so
#154, #156, #158 and #159 predate every part of the gate: at their head commits there is no
`stryker.config.mjs`, no `vitest.mutation.config.ts` and no Stryker in the lockfile, and
`pnpm install --frozen-lockfile` at those commits removes the runner outright. Each was replayed
with the **commit's own production code and its own tests**, over main's dependency set and main's
Stryker configuration — the only counterfactual available, since the thing being measured did not
exist then. The lockfile drift is almost entirely additive (1096–1302 inserted lines against 4–39
deleted, and the deletions are reflow rather than downgrades), and Stryker's own initial test run is
the validity guard: it aborts and writes no report if the commit's tests do not pass against the
grafted dependencies. All four produced reports, so all four had a green baseline. **No replay was
excluded**; where a graft was used it is marked in the table.

### Per-PR results

`survivors` is what the file-wide reporting scope reported; `findings` is what the changed-line
failure scope would have blocked on, after per-line folding.

| PR | what it was | files | mutants | survivors | findings | actionable | non-actionable | Stryker |
| --- | --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| #154 † | `test(e2e)+fix(importer)` revival loop | 12 | 1294 | 113 | 6 | 2 | 4 | 42s |
| #156 † | `fix(slskd)` failure vocabulary | 3 | 380 | 31 | 4 | 2 | 2 | 31s |
| #158 † | `fix` close the enforcement gaps | 7 | 620 | 76 | 11 | 2 | 9 | 42s |
| #159 † | `chore(quality)` strictest lint tier | 15 | 1554 | 134 | **0** | 0 | 0 | 111s |
| #161 | `chore(mutation)` adopt StrykerJS | 2 | 394 | 13 | 1 | 0 | 1 | 39s |
| #162 | `feat` end-to-end correlation | 51 | 2965 | 259 | 48 | 18 | 30 | 116s |
| #163 | `test(mutation)` burn down 464 → 19 | 36 | 4264 | 27 | 1 | 0 | 1 | 208s |
| #165 | `fix(musicbrainz)` uncomparable title | 4 | 497 | 1 | **0** | 0 | 0 | 25s |
| **Total** | | | **11 968** | **654** | **71** | **24** | **47** | |

† replayed with the dependency/config graft described above.

**Effective false positives: 47 of 71 findings — 66.2%.** The bar in `quality-gates.md` is under
ten percent. This is not near the bar; it is more than six times it.

The result does not hinge on the arguable calls. #162 is the least representative PR in the set (its
head predates #163's burn-down, so it landed on a codebase carrying ~464 survivors), and removing it
entirely makes the rate **worse**: 17 of 23, or 73.9%. Flipping every finding either agent marked
"arguable" to actionable still leaves the rate far above ten. There is no reading of this data that
clears the gate.

Two rows are worth reading for what the design got *right*. #159 and #165 name **zero** findings
while their reports carry 134 and 1 survivors respectively — the changed-line scope is doing exactly
the job D1 designed it for, refusing to fail a branch for debt it did not create. The problem is not
that the failure scope is too wide. It is what remains inside it.

### What the false positives actually are

Four families account for all 47, and they differ sharply in whether anything can be done about them.

- **Arid-adjacent control flow (the largest family).** The `arid-logging` ignorer retires mutants
  *inside* a `logger.*()` call, but not the `if` that decides whether the call happens, not a block
  whose entire body is one log statement, and not a call through an injected `warn` sink rather than
  a literal `logger.*`. So `if (result.isErr()) logger.warn(…)` yields two surviving
  `ConditionalExpression` mutants whose only observable difference is a log line, and a
  `catch (error) { scope.logger.warn(…) }` yields a `BlockStatement` survivor with the same
  property. The same shape produces the six `bestEffort(…, 'record search')` label strings in #158,
  which reach nothing but a log template. The only available fixes are a fiction test asserting a
  log call or a suppression comment — the appeasement the admission contract exists to prevent.
  **Fixable, in the ignorer plugin**, and this is the single highest-value remedy available.
- **Span-overlap attribution over pre-existing debt.** A `BlockStatement` mutant spans its whole
  block, and `isOnChangedLine` is deliberately overlap rather than containment (D2, and rightly so —
  containment silently drops the whole-block family). The consequence is that touching *one* line
  inside a block makes the block's pre-existing gap this branch's finding. #162's
  `this.logger` → `scope.logger` sweep did this across dozens of blocks: the reactor's
  `if (stream.isErr()) { … }` at line 248 is flagged because line 249's logger receiver was renamed.
  This is D1's "fails a branch for debt it did not create" arriving through the mechanism D1 chose.
  **Partly fixable in the verdict**, but only by trading away the whole-block detection D2 bought;
  requiring the mutant's *start* line to be a changed line is the cheap approximation.
- **Known equivalents the repo has already triaged.** #161's and #163's single findings are both
  from the seventeen "equivalent, waiver withheld" rows in `mutation-gate`'s design — indeed #163's
  finding *is* the row `downloader/domain/shared/duration.ts:25`, `actualMs !== undefined`, whose
  guarded comparison is NaN-safe either way. These lines are known-false and deliberately
  un-waivable: `Stryker disable next-line` keys on (line, mutator), and each of these lines also
  carries a killable mutant of the same mutator, so the waiver would silence a real finding. Any
  branch touching one of those seventeen lines blocks on a finding with **no fix that is not worse
  than the original code** — the quality-gates definition of an effective false positive, in as many
  words. **Not fixable** without upstream per-node suppression.
- **Composition roots the mutation suite cannot reach.** `vitest.mutation.config.ts` is the unit and
  contract tiers only; the tier that exercises real wiring is the excluded E2E one. So
  `ports = { … }` → `{}` in a composition root survives structurally, not for want of a test anyone
  would write. The spec forbids excluding these directories, which is defensible, but the effect is
  a standing supply of unkillable findings. **Fixable only by changing which tiers the mutation run
  executes.**

The genuine findings, for balance, cluster just as tightly and are worth acting on independently of
the gate: a newly exported `isCycleStart` predicate with no direct test, a new `parseMetadata`
exercised everywhere and asserted nowhere, the beets bridge's `argv` unpinned, and
`state.ts`'s watermark fold where both `Math.max` → `Math.min` and the `incoming === undefined`
guard survive.

### The three predicted false-positive sources, priced

The section above this one predicted three. Two are now measured and one was never reached.

1. **A pure rename gates the whole moved file — CONFIRMED, and it is worse than "the diff is
   restricted".** Measured twice. Against a real historical rename (`4ffc213b`,
   `interfaces/contracts/schemas.ts` → `facade/schemas.ts`), cutting the diff with the pathspec the
   job uses defeats git's rename pairing and emits the destination as `new file mode 100644` with a
   single hunk `@@ -0,0 +1,188 @@`. Then constructed end to end at `main`: renaming
   `domain/shared/duration.ts` → `track-duration.ts` and repointing its two importers — a branch
   that changes no behaviour whatsoever — produces `@@ -0,0 +1,28 @@` over the moved file, 145
   mutants, and **one blocking finding**, which is 100% false by construction. It compounds with the
   family above: the survivor it named is one of the seventeen known equivalents, so renaming any
   file containing one blocks the branch with a finding that cannot be waived. `--no-renames` in
   `DIFF_FLAGS` is the candidate remedy and is now backed by evidence.
2. **A scope of only `CompileError` mutants reads as audited — REACHABLE BUT UNOBSERVED.** The hole
   is confirmed by reading: `CompileError` and `RuntimeError` sit in `DETECTED`, and `auditGap` keys
   only on `mutants === 0` and `mutants === ignored`, so a scope in which every mutant failed to
   compile returns `clean` rather than refusing. **No replay hit it**: `CompileError` was zero in
   every run — the eight PR replays (11 968 mutants), the rename experiment (145), and both reruns.
   Recorded as unpriced rather than as absent — this is a
   silent-green hazard (a false *negative*), so it weakens the gate rather than annoying anyone, and
   it does not enter the false-positive rate either way.
3. **Rerun stability — MEASURED, and the decision is stable.** #163 and #162 were each replayed
   twice from the same commit. Both reruns produced the **same verdict kind and the identical set of
   (file, line) findings** — 1 and 48 respectively — and #163's rendered verdict was byte-identical.
   Two caveats. #163's underlying counts moved (3841 Killed / 50 Timeout versus 3846 / 45): five
   mutants flipped between `Killed` and `Timeout`, which is invisible here only because
   `report-model.ts` counts `Timeout` as detected, and a `Killed` ↔ `Survived` flip on a changed line
   would have flipped the verdict. And in #162 six rows named a *different representative mutant* on
   the rerun, because `foldPerLine` keeps the first survivor it meets and Stryker's per-file mutant
   order is not stable — so an author who fixes "the named mutant" may be shown a different one next
   run. Cosmetic rather than blocking, but real, and worth fixing by folding on a deterministic key.

### The decision (task 5.2)

**At 66.2% effective false positives against a bar of under ten, the gate does not earn a blocking
seat. `MUTATION_GATE_ENFORCE` stays absent and the verdict stays in shadow.** `mutation-gate` 4.1a
and 4.1b are **not** handed off; neither the workflow switch nor the branch ruleset should be
touched, and they must continue to move together whenever they do move.

This is the outcome `quality-gates.md` names explicitly: *"A check can be worth running once without
earning a seat."* The run was worth it. It produced 24 genuine, specific test gaps that no other
instrument in this repo surfaces, and it did so on changed lines only — #159 and #165 show the
scoping is sound. Keeping it as a published, non-blocking summary is the honest deployment for a
check whose findings are two-thirds noise.

What would have to change before this is worth re-measuring, in the order the evidence supports:

1. **Extend the `arid-logging` ignorer** to cover a branch or block whose only effect is a log call,
   and calls through injected `warn`/`error` sinks. This is the largest family and the cleanest fix,
   and it lands in a plugin that already exists for exactly this purpose.
2. **Add `--no-renames` to `DIFF_FLAGS`**, which removes an entire class of 100%-false blocking runs
   for a one-word change, now that the cost is measured rather than assumed.
3. **Decide the span-overlap trade** deliberately: require a mutant's start line to be a changed
   line, accepting the loss of some whole-block detection, or keep overlap and accept the
   attribution noise. This is a real trade-off and should not be made by default.
4. **Close the `CompileError` audit gap** — a fourth refusal keyed on mutants actually *tested*.
   Unobserved, but it is a silent green, which is the failure mode this design fears most.
5. Only then re-run this measurement, on **live** PRs rather than a backtest, and preferably after
   the seventeen known equivalents have a real answer — because until they do, every branch that
   touches one of those lines blocks on a finding nobody can fix.
