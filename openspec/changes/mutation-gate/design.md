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

**SUPERSEDED in its second half** — the sequencing below is retired, and
`docs/research/blocking-mutation-gate-scope.md` is the authority on why: "until main is
mutant-clean" names a state no suite reaches, because the equivalent fraction among survivors
rises as the suite improves. `openspec/changes/mutation-gate-diff-scope/` replaces it with
line-scoped failure shipped in shadow mode. The first half still holds and still explains why:
flipping first would block every PR on pre-existing debt that no diff owns. Kept unedited below
because the reasoning that produced it is the reasoning the research doc corrects.

~~Order inside the change: land config + scripts + CI job non-required → run the initial
full-repo pass → triage into kills/suppressions until main is mutant-clean → *then* Jake
flips the job to required in the ruleset. Flipping first would block every PR on
pre-existing debt that no diff owns.~~

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

## Decisions taken during adoption

Three decisions below were not in the drafted design. Each is recorded because it changes what
the gate measures, and a decision nobody wrote down gets relitigated by the next person to notice
the setting.

### D4a — Incremental mode is opt-in per command, not the PR job's default

D4 assumed the PR job would run Stryker incrementally against a cache keyed on main's head. It must
not. Stryker's incremental report is **whole-repo**: it merges cached results for files this run did
not mutate into the final report, and the break threshold then applies to that merged whole. In the
PR job that converts a diff gate back into a repo gate — a branch would fail on surviving mutants in
files it never touched, which is precisely the pre-existing-debt blocking D5's ordering exists to
prevent.

So: the PR job scopes with `--mutate <changed files>` and runs fresh; `pnpm test:mutation` passes
`--incremental` because a local run IS whole-repo and reusing the previous verdict is pure win; the
weekly run stays fresh because it is the authoritative inventory. The CI cache steps D4 called for
are dropped with it — there is nothing worth caching when each PR mutates only its own changed
files.

### D6 — Log statements are arid, by a configured rule rather than by suppression

Roughly a third of the seeding run's survivors (253 mutants) sat inside `logger.*()` calls. They are
arid in the Google sense: the domain does not log at all (bootstrap-acquisition-core D15,
verified: zero logger calls under `packages/*/src/domain`), and elsewhere a log call's message
and context reach a transport and influence nothing a test should assert on. No honest test kills
them; the only test that would is one pinned to a diagnostic.

They are retired by a local Stryker ignore-plugin (`scripts/mutation/ignore-logging.mjs`), not by
253 `// Stryker disable` comments. The waiver doctrine asks for exactly that shape — "A rejected rule
is disabled **once, in configuration, with its reason** — visible to everyone. A per-site suppression
is the exception" — and names the alternative as an anti-signal: "a rising suppression count is the
signal that the rule failed admission and nobody noticed."

The rule is deliberately narrow, and its scope is pinned by tests
(`scripts/mutation/ignore-logging.test.ts`): only mutants inside the *argument list* of a call whose
receiver names a logger and whose method is a statically-named level. The statement around the call
stays observed — emptying a block that happens to contain a log line can also drop a `return`.
`logger.child(…)` is not matched. `reporter.error(…)` is not matched: the rule keys on the receiver,
never on the verb.

### D7 — Static mutants are rejected as a class (`ignoreStatic: true`)

The seeding run reported **160 surviving static mutants** — those whose code executes only while a
module is being loaded. They are false.

Measured, not assumed: one of them — emptying `createMatchPolicy`'s body in
`domain/policy/policies.ts` — was applied by hand and **fails 27 test files**. The suite detects it
perfectly well; Stryker cannot. The vitest runner activates a mutant through a global read at
runtime, but module-level code has already been evaluated by the time that global is set, so a
static mutant is never actually exercised and reports as surviving however well tested it is.
160 of run 2's 807 survivors were reported static; 135 of them vanished outright when D7 landed
(160 → 25), the rest being static mutants that also execute inside tests. So roughly a sixth of the
survivor list was this artefact, and about a fifth of it was reported as static.

That fails the admission contract twice: the findings are false, and their only available "fix" is
to stop initialising anything at module scope — contorting real code to satisfy a tool that cannot
see it, which is the appeasement the contract exists to prevent.

Cost, stated plainly and measured: **565** mutants leave the measurement — not all 1078 Stryker
flags as static, because `ignoreStatic` drops only those that run *solely* at module load; the other
~513 also execute inside tests and stay fully measured. A genuine assertion gap in module-level
initialisation will no longer be reported, and the sharpest casualty is named under "D3 meets D7"
below. Accepted — a signal that is wrong a fifth of the time is worth less than the assurance it
buys. **Deferred item:** revisit if the vitest runner gains per-mutant module reloading.

### The mutator rule-pack: admitted whole, with two class-level rejections

Stryker's mutator set is a rule pack, and the admission contract requires rule-by-rule triage rather
than a blanket enable. Every one of the 14 mutators producing findings was **admitted**: each
family's survivors include genuine assertion gaps, and none produced findings whose only available
fix was worse than the original code. `StringLiteral` was the closest call — its 295 raw survivors
looked like noise until they were read, at which point the family turned out to contain the
`quality-policy` lossless-codec table and the facade's bucket enums, both real. It is admitted, and
D6/D7 remove the parts of it that were not findings at all.

The two rejections above are therefore *class*-level, not mutator-level: arid log arguments (D6) and
static mutants (D7). No mutator is disabled.

## Seeding tally (task 2.x)

Measured on 16 cores, full repo, `pnpm exec stryker run`. Every figure below is read out of the
run's own JSON report, and the two class rejections are reported by Stryker as `Ignored` with their
reason attached, so the split is checkable rather than asserted:

| Run | Config | Mutants | Ignored | Survivors | Score |
| --- | --- | --- | --- | --- | --- |
| 1 | unit suites only | 6784 | 0 | 829 | 87.78% |
| 2 | + contract tiers in the runner | 6784 | 0 | 807 | 88.10% |
| 4 | + arid-logging (D6), + `ignoreStatic` (D7) | 6784 | 818 | 472 | 92.09% |
| 5 | + the review-cycle kills below | 6778 | 820 | 464 | 92.21% |
| 6 | + the task-2.1 burn-down, as first written | 6717 | 1015 | 6 | 99.89% |
| 7 | + the review sweep's waiver corrections | 6701 | 893 | **19** | **99.67%** |

Run 7 is the honest one, and it is worse than run 6 on both numbers **on purpose**. Review found that
run 6's suppressions were hiding 104 mutants the suite already killed (below), so run 7 suppresses
122 fewer mutants and reports 13 more survivors. A score that falls because the measurement stopped
lying is the only kind of fall worth having; run 6 is left in the table as the counterexample.

Full-run wall clock on 16 cores: 7m40s (run 1), 8m52s (run 2, contract tiers included), 7m29s
(run 4), 7m35s (run 5). This is the line `mutation.yml`'s timeout comment cites.

Run 5's total is 6778 rather than 6784 because deleting `quality-policy.ts`'s equivalent
`codec !== ''` condition removed six mutants that could never have been killed.

Run 3 was a discarded partial: it was killed mid-flight when D7 was discovered, and its config
matched no shipped state. It is listed here only so the numbering is not a mystery.

**The ignored count reconciles exactly**: at run 4, 818 = 253 arid-logging + 565 static. Run 5 was
measured at 820, when this change's single inline waiver still sat on a combined condition and so
covered two `LogicalOperator` mutants. Review split that line afterwards precisely because only one
of the two is equivalent, so at HEAD the figure is **819** — 818 plus the one waived mutant; the
other is audited again and killed, which is why the survivor count is unchanged at 464.

The 253 arid mutants are *not* all former survivors: the by-kind split below attributes a 200-mutant
dynamic drop to the rule, so roughly 53 of them were already being detected by some test and simply
leave the denominator. "A third of the survivors" is the right order of magnitude for the family,
not an exact identity. Note the second number is
*not* the 1078 mutants Stryker flags as static — `ignoreStatic` only drops those that run
**solely** at module load. The other ~513 also execute inside tests and stay fully measured, which
is why D7 costs far less assurance than the raw static count suggests.

Survivors by kind, which is what D7 actually bought: run 2 had 160 static + 647 dynamic survivors;
run 4 had **25** static + 447 dynamic. The 135 static survivors that disappeared are the
unkillable artefacts D7 documents. The dynamic drop (647 → 447) is the arid-logging rule.

**Killed by strengthened tests** — all red-first: the mutant was watched surviving in the report,
the test written, then the kill verified by re-running Stryker over the file *under the shipped
config*. That last clause matters, and an earlier draft of this document got it wrong: it credited
27 kills in `quality-policy.ts` by comparing a pre-`ignoreStatic` run against a post-`ignoreStatic`
one, so most of that "27" was D7 removing static mutants, not tests killing them. Re-measured
honestly by running the file with the old tests and the new ones under identical config:

- `domain/policy/quality-policy.ts` — **11 → 0 survivors; the file is now mutant-clean.** The
  lossless-codec set had 2 of its 11 members actually asserted, so dropping `aiff` or `wavpack`
  changed no verdict. Both bitrate thresholds were sampled either side but never *at* the boundary,
  leaving `>=` and `>` indistinguishable. Hi-res was only ever satisfied by bit depth and sample
  rate together (its sample-rate-alone twin already existed; bit-depth-alone did not). And the
  no-codec guard was only ever reached by the other route, so it was never the thing deciding.
- `domain/import/state.ts` — 11 → 9. **The seam watermark folded as a max, and nothing said so.**
  `Math.max(previous, incoming)` → `Math.min` survived the whole suite, because every existing
  scenario settled at one position and probed around it — which a fold that kept the earlier value
  satisfies equally well. That fold re-imports a delivery the stream has already run. Same defect
  class as the previously-unpinned optimistic-concurrency check, found systematically this time.
- `domain/import/decide.ts` — 15 → 13. `bestOf` used `<` to keep the earliest of equally-distant
  candidates; `<=` survived, meaning the chosen match could depend on proposal arrival order.

**One production simplification, and one waiver.** `quality-policy.ts`'s `codec !== ''` guard was a
genuinely equivalent condition (the empty string is not in the codec set), so it was *deleted*
rather than waived — the top of the promotion ladder, where the state stops being representable.
`decide.ts`'s watermark guard carries this change's only `// Stryker disable`: replacing the first
`&&` with `||` cannot change the result, because the third operand is true only when both operands
are defined, and where both are defined the two operators agree. That is an equivalent mutant, it
is suppressed at the site with that reasoning written out, and it was the one waiver in the repo —
which also means `mutation-scope.test.ts`'s justification scan runs over a real suppression rather
than an empty set. (That waiver no longer exists: the task-2.1 burn-down extracted the rule it
guarded into a named predicate, and the repo's waiver count is now 58 — see the burn-down section.)

No test was written to feed the gate. Every test above pins a behavior a competent reader would
want asserted, and all of them passed on first run against unmodified production code — the code
was right, the tests were weak.

## The task-2.1 burn-down: 464 → 19

The 464 survivors recorded here after the seeding pass were triaged file by file. The count now
stands at **19**, at a mutation score of **99.67%** (6701 mutants: 5712 killed, 77 timed out, 893
ignored — 818 by the D6/D7 class rejections and 75 by inline waivers — and 19 surviving). Every kill
was verified the same way the seeding kills were: the mutant was applied by hand at its exact
reported location, the suite was watched failing, and the mutant was reverted.

### The waiver layer was wrong, and it took a review sweep to see it

The first version of this burn-down reported **6** survivors at **99.89%**. That number was not
real, and the way it failed is the most transferable thing in this document.

**A `// Stryker disable` is coarser than the sentence next to it.** It keys on *(start line, mutator
name)* — no column, no AST node — so it silences every mutant that mutator generates on that line
while the written reason argues about one operand. `ConditionalExpression` emits `true` **and**
`false` for a single guard; `EqualityOperator` emits `>=` **and** `<=` for a single `>`. Fifteen
waivers were therefore switching off a killable twin, sometimes the twin that a test *added in this
very change* was written to kill. `ranking.ts` is the sharpest: the waiver argued `>=`, and the same
directive silenced `<=`, which inverts `candidateQualityBucket` to return the release's **best**
bucket instead of its worst — the quality-floor bypass D11 exists to prevent — killed by the
`worst first` / `worst last` table this change added.

**Worse, two waivers never ended.** This change introduced the repo's only two block-scope
`// Stryker disable` … `// Stryker restore all` pairs, and the `restore` never fired. Stryker's
`DirectiveBookkeeper` reads only a node's *leading* comments; both `restore` comments sat as the last
token inside a `case` with no statement after them, so Babel attached them to nothing. A block rule
with no end line matches every subsequent line, so suppression ran **to end of file** — 64 mutants in
`downloader/.../projections/read-models.ts` and 32 in `effect-lander.ts`, covering the whole of
`projectStatus`, `StalledReadModel`, and `land()`'s retry-vs-dead-letter decision. Both files
reported a mutation score of 100.00 while most of their control flow was unmeasured. `effect-lander`'s
landing decision is the downloader's counterpart to the boundary the importer's reactor explicitly
refuses to waive because it "stays measured"; it had stopped being measured by accident.

**The audit, and what it cost.** Every mutant on every waived line was enumerated by running the
instrumenter and reading its `Ignored` set back, then every silenced mutant the reason did not argue
about was hand-applied and run. Result: the 68 directives were silencing **206** mutants, not the
~90 first claimed, and **104 of those were killable** — the suite caught every one of them the moment
the directive was removed. None of it was an unguarded regression: the tests existed and passed
throughout. What was lost was measurement, and an inflated score built on it.

The fix took the repo to **58 directives across 19 files, silencing 75 mutants**, all verified: the
two block forms rewritten as per-label `next-line` waivers, fifteen waivers **withheld** (their
equivalent mutant now reports as an honest survivor, because for this family the equivalent and its
killable twin are the same node and no line split can separate them), three guards **deleted**
outright as dead, one **killed** with a red-first test, and three `sleep` waivers **split** so the
`Promise` executor stays measured — that one silenced a mutant which never calls `resolve`, i.e. a
permanent hang, not the "wall-clock only" difference its reason claimed.

Two waivers were also plainly false and are gone: `facade/mapping.ts` claimed "no input can make the
two arms disagree" about a ternary its own test contradicts with `discNumber: 2`, and
`transfers.ts`'s peer-redaction placeholder claimed equivalence for a mutant that *deletes* a
username instead of replacing it — which can splice a failure-vocabulary phrase into existence
(`'the wait tiXmed out'` with peer `X` becomes `'timed out'`, turning `TransferError` into
`Stalled`). Peer names are attacker-chosen; that one is now a test, not a waiver.

**The guard that would have caught it.** `test/boundaries/mutation-scope.test.ts` now rejects the
block form outright, with the leading-comment mechanism written out as the reason, and carries a
suppression-count ceiling of 58 — a number to drive down, never to spend. That is the promotion
ladder working as intended: a rule discovered by review became a machine rule in the same change.

Two facts about the survivor list were only learned by burning it down, and both are worth carrying
forward because they change how a future reader should read a Stryker report.

**The mutant is a sub-expression, not the line.** A report row prints the whole source line, but the
mutated span is usually one operand of it. `duration.ts`'s `actualMs !== undefined && isWithin…(…)`
reported as "the condition becomes `true`" is in fact only the LEFT operand becoming true — a
completely different claim, and in that case an equivalent one. Reading a survivor off the printed
line rather than off `location.start/end` column-wise produces confident, wrong triage; it cost
more than one agent a wasted cycle. This is also why a `// Stryker disable next-line` is blunter
than it looks: the directive keys on *(line, mutator)*, so it silences every sibling mutant of that
mutator on the line. Several suppressions here are preceded by a deliberate line split so the waiver
covers only the equivalent operand and leaves its killable twin measured.

**The dominant failure was not missing tests — it was tests that could not fail.** The survivor list
was not, as expected, a list of untested code. Overwhelmingly it was tests whose fixtures made the
assertion true regardless of the behaviour under test. Four recurring shapes:

- **A tie-break doing the work.** Three of the four ranking tiers in `ranking.test.ts` — quality
  over match, match confidence, and source speed — asserted an expected order that happened to be
  the *alphabetical* order, which is the last-resort identity tie-break, so each of those three
  could be deleted with a green suite. (The free-slots tier was genuinely pinned: its old
  expectation `['roomy','short','busy']` is not alphabetical, and deleting the `freeSlots`
  comparison would have failed it. Review corrected an earlier draft of this paragraph that claimed
  all four.) Fixed by naming the fixtures so identity contradicts the tier under test.
- **A test double flattening the arithmetic.** slskd's fake clocks started at `0`, where `now - start`
  and `now + start` agree; both elapsed-budget mutants survived only for that reason. Moving the
  fixtures to a realistic epoch killed them with no new tests.
- **A setup that was silently a no-op.** The importer reactor's "stop() clears the real timer" test
  re-seeded an existing stream, which optimistic concurrency rejects, so its second half proved
  nothing. MusicBrainz's "official edition yields no target" test browsed non-UUID ids that the
  mapper dropped, so it passed for the wrong reason. `slskd`'s "restart an aborted-but-winding-down
  candidate" never actually had a live predecessor at the moment the guard ran.
- **An order-independent assertion for an order-dependent rule.** Both SQLite upcaster suites named
  "registration order must not matter" in a comment, then asserted with `toEqual` over an object
  whose keys each step set distinctly — order-blind by construction. Steps registered 1, 5, 3 were
  applied 1, 5, 3 and nothing noticed.

None of these were caught by 100% line coverage, and none would have been caught by a reviewer
reading the test names. That is the case for mutation testing in this repo, made concretely.

### What the burn-down found

No live defect was found — in every case production was correct and the tests were weak — with one
exception recorded below as an open question. The unpinned invariants worth naming, because each is
a durability or safety rule that had nothing behind it:

- **Staged files could have leaked on cancellation.** `state.ts`'s `phase === 'Importing'` operand
  (downloader) was pinned by nothing: a cancellation arriving mid-import would have folded the
  staging away, `react` would emit no `Cleanup`, and the rejected files stay on disk — the exact
  hazard D13 exists to prevent. The `Validating` twin was tested; `Importing` never was.
- **Human review could have been bypassed entirely.** The importer composition root's
  `policy: { autoApplyThreshold }` could be replaced with `{}`; with the threshold `undefined`,
  `distance > undefined` is false and *every* proposal auto-applies. The whole importer suite passed.
- **The downloader's fallback poll — the delivery guarantee — was unpinned at the composed level.**
  Four separate mutants disabled the parked-effect retry path (no interval scheduled, the stopper
  neutered so the poll outlives the closed DB, the jitter source undefined, the retry policy emptied)
  and all four survived.
- **The seam's replay guarantee was unpinned.** `outbound-feed.ts`'s prefix filter could be deleted
  outright: every fixture published the *last* event of its stream, so "rendered as of the event,
  replay-safe" was never exercised, and a payload could silently depend on when it was fetched.
- **The whole second half of the importer's re-proposal loop was unfolded.** Nothing folded
  `CandidatesProposed`, `AutoApplySelected` or `ReviewRequired` onto a `proposing` state, so a
  re-proposal would be discarded and the import strand forever with the human still looking at the
  list the re-proposal was meant to replace.
- **An in-place re-import could have fired with no retry in flight** (`react.ts`), re-running beets
  over files already in the library; the property suite checked the effect's shape but not the state.
- **Retry budgets and time budgets were untested AT the boundary** in five places (the importer
  subscription's last attempt, slskd's queue-wait and stall timeouts, `maxQueueWaitMs`, the duration
  tolerance). A budget one attempt short passed the suite everywhere.
- **PII redaction was weaker than it read.** The slskd peer-redaction test asserted only that the
  whole username was absent, so shortening the regex quantifier — leaking most of the name into
  dead-letter-bound strings — survived.
- **Two adapters could not say which failure they had hit.** ffprobe reported the same message for a
  broken binary and a schema-drifted one; the filesystem library's EXDEV guard could be forced open,
  papering a permissions fault over as a successful import.

### The 19 that remained at the pre-rebase tip, and why each was left

**Superseded as an inventory** — the authoritative survivor list is the table under "The v3.18.0
burn-down" below, which reflects HEAD. This section is kept for its reasoning, which still holds and
has since been confirmed by measurement rather than argument. Three of its rows are gone: the two
MusicBrainz `''` mutants (the album-title open question, now fixed) and
`domain/acquisition/acquisition.ts:103` (respelled).

One survivor is missing from this table on purpose, because it is the clearest illustration of why
reading a mutant off the printed line is dangerous.
`downloader/application/acquisition/reactor.ts:548` reported as "the queued-window predicate becomes
`true`", and the obvious reading — the lower bound is gone — was already pinned. The mutated span
was in fact the *upper* bound, `event.globalSeq <= this.lastProcessed`, and removing it is a genuine
defect class: `retryDueParked()` runs at the head of a drain pass, before `store.readAll`, so an
event appended since the previous pass is still above the checkpoint when a park falls due.
`resumeStream` would dispatch its effect, and the catch-up read would dispatch it **again** moments
later in the same tick — the double-dispatch half of the no-leapfrog rule. It is now killed by a
test that parks a stream, lets a later event land undrained, and asserts the resulting `Cleanup`
fires exactly once. Unpinned behaviour, not a live defect — but it was one triage step away from
being waived as equivalent.

The list as it stood then (regenerate the current one with `pnpm exec stryker run`):

| Site | Mutated span | Verdict |
| --- | --- | --- |
| `downloader/adapters/musicbrainz/mapping.ts:231` | `''` | open question (below) |
| `downloader/adapters/musicbrainz/mapping.ts:238` | `''` | open question (below) |
| `importer/domain/import/decide.ts:250` | `state.phase !== 'awaiting-review'` | equivalent, waiver withheld |
| `downloader/domain/shared/duration.ts:25` | `actualMs !== undefined` | equivalent, waiver withheld |
| `downloader/adapters/musicbrainz/mapping.ts:301` | `count <= modal` | equivalent, waiver withheld |
| `downloader/domain/ranking/ranking.ts:48` | `bucketRank(…) >= bucketRank(…)` | equivalent, waiver withheld |
| `downloader/domain/policy/policies.ts:69` | `timeBudgetMs !== undefined` → true | equivalent, waiver withheld |
| `downloader/adapters/slskd/poll.ts:28` | `filename !== undefined` → true | equivalent, waiver withheld |
| `downloader/adapters/slskd/client.ts:141` | `body !== undefined` → true | equivalent, waiver withheld |
| `downloader/domain/acquisition/decide.ts:333` | guard → false | equivalent, waiver withheld |
| `downloader/domain/acquisition/state.ts:339` | `phase !== 'Fulfilled'` → false | equivalent, waiver withheld |
| `downloader/domain/acquisition/acquisition.ts:103` | ternary test → true | equivalent, waiver withheld |
| `downloader/application/projections/read-models.ts:329` | `streamId !== undefined` → true | equivalent, waiver withheld |
| `importer/application/projections/read-models.ts:182` | `type === 'ImportRequested'` → true | equivalent, waiver withheld |
| `importer/application/projections/read-models.ts:215` | `directory === undefined` → false | equivalent, waiver withheld |
| `importer/application/projections/read-models.ts:280` | `streamId !== undefined` → true | equivalent, waiver withheld |
| `importer/application/import/use-cases.ts:105` | ternary test → false | equivalent, waiver withheld |
| `importer/facade/mapping.ts:51` | ternary test → false | equivalent, waiver withheld |
| `importer/adapters/beets/bridge-adapter.ts:96` | ternary test → false | equivalent, waiver withheld |

**"Equivalent, waiver withheld" is a deliberate position, not an omission.** All seventeen are pure
type narrowings (or, in the two operator cases, the one operator substitution the surrounding
invariant makes unobservable): the field they guard is declared on one member of a union, so the
unguarded read is `undefined` on every other member and the comparison is false either way. They
could each be waived — but **each sits on a line that also carries a killable mutant of the same
mutator, and `Stryker disable next-line` keys on (line, mutator), not on a node.** A waiver here
does not silence the mutant its reason argues about; it silences every mutant that mutator generates
on the line. Trading a real finding for a cosmetic zero is exactly the "waiver that moves the
problem" the doctrine rejects.

**Splitting the line does not help, and that is a property of the mutators rather than of this
code.** `ConditionalExpression` emits `true` *and* `false` for the same node, and `EqualityOperator`
emits both the tightening and the inverting substitution for the same operator token — so the
equivalent mutant and its killable sibling are always co-located, whatever the formatting. The only
shapes where a split works are ones where the two mutants belong to *different nodes*: the hoisted
`const facts = …` in `importer/domain/import/import.ts`, the `stop` returns in the downloader
reactor, and the `delay()` helper both composition roots now share (below).

**The fifteen added by the waiver-scope audit are not new survivors** — they were surviving all
along, hidden by waivers whose prose argued one operand while the directive silenced the whole line.
Recording them is the correction; the mutants themselves did not change.

**Two came off the list, by a spelling that has no equivalent mutant to begin with.**
`import.ts`'s `location` and `state.ts`'s `hasRemediation` both asked `state.phase === 'applied'` in
order to read a field declared on `AppliedState` alone. `'location' in state` / `'remediation' in
state` asks the *same* question in one operand — and `in` is not a `ConditionalExpression` operator,
so the equivalent mutant simply does not exist. Both lines are now fully measured (five mutants
between them, all killed), and `import.ts` merely matches the `'directory' in state` on the line
above it. The remaining `decide.ts` guard was deliberately left alone: rewriting a decider's phase
guard as a property-presence test would cost the domain reader more than the score is worth.

**Cost, stated plainly:** a future PR touching one of these files will see the mutation job report a
survivor it did not create. That is the friction these rows buy, and it is why the job must stay
non-blocking until either the `ignore-unions` rule below lands (**RETRACTED — measured impossible;
see "Measured: no Stryker mechanism can suppress one mutant of a node"**; a config rule
inspects the AST node and *can* be precise where a line-scoped comment cannot) or the ACL question
below is settled.

### The rebase onto v3.18.0 proved the gate's case better than the burn-down did

This branch was rebased onto `main` after v3.18.0 landed mid-flight (the correlation-context change:
an `OperationScope` threaded through both reactors, both interpreters, the composition roots, and
the event stores). Re-measuring at the rebased tip:

| | mutants | ignored | survivors | score |
| --- | --- | --- | --- | --- |
| this branch, before the rebase | 6701 | 893 | 19 | 99.67% |
| the same branch, rebased onto v3.18.0 | 7088 | 929 | **64** | 98.96% |
| after the v3.18.0 burn-down below | 7100 | 929 | **27** | **99.56%** |

The burn-down did not regress. **v3.18.0 arrived carrying 45 surviving mutants of its own**, in the
production code it added — clustered in `importer/domain/import/events.ts` (10), the two
`interfaces/contracts/events/mapping.ts` ACLs (7 and 5), both `adapters/sqlite/event-store.ts` (4
each) and `application/correlation/context.ts` (3).

That is the whole argument for task 4.1, delivered by accident and worth more than the burn-down
number it spoils:

- **A one-off sweep cannot hold.** 464 → 19 took a day; a single unrelated feature put 45 back in a
  week. Mutation debt is a flow, not a stock, and only a diff-time gate meets it at the rate it
  arrives. This is exactly the deployment-model finding `quality-gates.md` opens with.
- **The gate saw them and let them through.** The mutation job ran on v3.18.0's own PR, mutated its
  changed files, and reported these survivors into the step summary — where nothing consumed them,
  because the step is `continue-on-error` and the check is not required. An advisory finding with no
  consumer is the attested-dead shape D2 exists to reject, and here it is, observed on this
  repository rather than argued from the literature.
- **The diff-scoped gate would have been fair to it.** Those 45 sit in files v3.18.0 itself changed,
  so a required check would have named its own debt, not inherited debt. That is the property D1's
  per-mutant-on-changed-files design was chosen for.

**This does NOT change the recommendation to leave `continue-on-error` in place in this PR** — the
ordering in D5 still holds *for the flag*, and flipping it while 64 survivors sit on main would
block the next unrelated PR on debt it did not create. (Read no further than that: the paragraph
below frames the burn-down as the road to the flip, which is exactly the premise retired under "Why
the gate still stays inert" — the road is line-scoping, not a shorter list.) It sharpens what has to
happen next: the flip is worth more than it looked, and what stands between here and it is *someone
else's* 45,
not this change's 19.

### Open question, now CLOSED: an album title that normalizes to nothing

The two MusicBrainz survivors are `release.title ?? ''` and `group.title ?? ''`. They are **not**
equivalent, and pinning today's behaviour would be fiction, because today's behaviour is unspecified.

An absent upstream title becomes `''`, and `''` compares equal to a request title that also
normalizes to `''` — which happens for real albums whose titles are pure punctuation: `÷` and `+`
(Ed Sheeran), `?` (XXXTentacion). The exact-title preference then fires on an untitled (or
differently-punctuated) high-confidence group and **bypasses the ambiguity guard** that would
otherwise have refused to choose. Two punctuation-titled albums are indistinguishable to
`normalizeTitle`.

This narrows the memory-held claim that the album path is "fully fixed": it is, for titles that
survive normalization. The principled fix is to carry an absent-or-empty identity title as
`undefined` rather than `''` and require a *present* title for the exact-title preference — the
"make the illegal state unrepresentable" rung, not a guard.

**Done, in `fix(musicbrainz)` — but not quite as sketched, and the difference matters.**

Red first: two scenarios were written and watched failing — a request for `÷` answered with `+`, and
a request for `÷` answered with a release MusicBrainz sent no title for — both bypassing an ambiguity
guard that should have refused.

The sketched fix (absent-or-empty → `undefined`, require a *present* title) makes those two refuse,
and shipped that way first. Review then caught what it also does: **it removes a right answer along
with the wrong one.** A request for `÷` against the genuine `÷` album and a within-margin rival used
to resolve correctly, by the exact-title preference. Under the sketch, `wanted` is `undefined`, no
group is titled, and the ambiguity guard refuses — so *every* punctuation-titled album becomes
permanently unresolvable whenever anything scores near it. Nothing pinned that loss either way, and
three reviewers converged on it independently.

The error in the sketch is a conflation it inherited from the bug: `÷` is not incomparable, it is
only incomparable **under this normalizer**. Treating "MusicBrainz sent no title" and "the normalizer
cannot represent this title" as the same fact is the same collapse the fix set out to remove, one
level up. So `comparableTitle` now falls back to the literal text when normalization empties a
*present* title, and returns `undefined` only for genuine absence. `÷` still refuses to match `+`;
`÷` matches `÷`; absence matches nothing, including another absence. The two value spaces cannot
collide — a fallback value contains no letter or digit by construction, and a normalized one always
contains at least one.

The fallback is deliberately **not** casefolded, and the code says so at the site: nothing reaching
that line contains a letter or a digit, so for every title it can actually receive there is no case
to fold. The exception is real but empty in practice — a few cased symbols exist (`Ⓐ`/`ⓐ`) and now
compare case-sensitively. Accepted rather than papered over, because a casefold there is a line no
honest test could pin.

Rung of the ladder, stated honestly because the first draft of this section overclaimed: this is
**not** rung 4. `undefined` is exactly as much a comparable value as `''` was as far as `===` is
concerned, and `isSameTitle`'s `wanted !== undefined` **is** still a guard someone could forget. What
changed is that the guard is written once, in one function, instead of implicitly at two call sites —
centralisation plus a test that kills its removal, which is a real win and rung 1-to-2 work, not
unrepresentability.

It does retire the two `''` survivors by **removing the sentinel they lived on** rather than by
asserting the unspecified behaviour they exposed — which is why the fix was worth doing and pinning
the old behaviour would have been fiction. Five tests now pin the area: the two refusals, the
punctuation-titled album that must still be *findable*, a separators-only title that must not be,
and a request spelled differently from MusicBrainz's own title (which is what "exact after
normalization" means, and was unpinned at this level — a surviving mutant found it). The file went
from 3 survivors to 1, and the new code is fully measured: every mutant in it killed.

### A `disable next-line` keys on (line, mutator) — not on the operand its reason argues

The first draft of this burn-down shipped 68 directives. A scope audit re-derived, for every one of
them, the exact set of mutants Stryker generates on the waived line — by running
`@stryker-mutator/instrumenter` over each file and reading the `Ignored` set back — and then applied
every silenced mutant the reason did **not** argue about, by hand, against the suite. Two mechanical
defects came out of it, both invisible while the score read clean:

1. **Two block-scope directives never ended.** `application/projections/read-models.ts` and
   `application/acquisition/effect-lander.ts` each opened `// Stryker disable <mutators>` and closed
   it with `// Stryker restore all` written as the last comment inside the final `case`. Stryker's
   `DirectiveBookkeeper` reads a node's LEADING comments only, so a comment with no statement after
   it inside its block is attached to nothing and never processed. A block rule with no end line
   matches *every* subsequent line, so the two waivers ran to end of file: **53 and 32 mutants
   silenced** against an argument written about one `switch` arm — the whole of `projectStatus`, the
   `StalledReadModel` seeding, and the whole of `EffectLander.land()`'s dead-letter/stalled decision,
   which is the retry-vs-dead-letter boundary the importer's reactor deliberately keeps measured.
   Both files reported a perfect score. Rewritten as per-label `next-line` directives; every one of
   the released mutants was then applied by hand and **all are killed** by the existing suite.
   `mutation-scope.test.ts` now fails on any block-form directive, and on any `Stryker restore` at
   all, so the shape cannot come back.
2. **Fifteen waivers silenced a killable sibling.** The directive keys on (start line, mutator), and
   both `ConditionalExpression` (`true` *and* `false` for one node) and `EqualityOperator` (`>=`
   *and* `<=` for one `>`) emit an equivalent mutant and a killable one from the same token. Every
   such waiver was withheld and its survivor recorded above — 30 real findings restored to
   measurement, the sharpest being `candidateQualityBucket`'s `<=` (returns the release's *best*
   bucket, the quality-floor bypass the function exists to prevent) and `modalTrackCount`'s
   `count >= modal` (inverts the documented lower-count tie-break).

Three more waivers were retired outright rather than rescoped: `artistCreditName`'s `.trim()` and
the two `length === 0` guards in the MusicBrainz mapping were *proved redundant by their own
waiver text*, so they were deleted (rung 1) — the guards' only effect was to reach the same `[]` a
line earlier. The slskd `'<peer>'` redaction placeholder turned out to be killable after all: a
peer named `X` splices `tiXmed out` back into `timed out` when the placeholder is emptied, so that
waiver was replaced by the test that demonstrates it. And the three `sleep` arrows in the
composition roots were silencing their `new Promise` **executor** as well as the delay — an executor
that never calls `resolve` wedges the caller forever, which is the opposite of "changes wall-clock
and nothing else". Each is now a named `delay()` function whose waiver covers the delay alone.

### The suppression count is now 58, and that is still a signal to act on

The seeding pass shipped exactly one inline waiver. The burn-down ships **58 `Stryker disable
next-line` directives across 19 production files, silencing exactly 75 mutants** — about 1.1% of the
6717, and now a *measured* number rather than an estimate: every directive's silenced set was
enumerated from the instrumenter, and every mutant in it either matches the reason written above it
or was applied by hand and confirmed to survive. Each carries a written justification and passes
`mutation-scope.test.ts`'s scan. So none of them is a shrug. But the doctrine is explicit that "a
rising suppression count is the signal that the rule failed admission and nobody noticed", and
1 → 58 is exactly that signal. It is recorded here rather than absorbed.

Read by mutator (mutants silenced, not directives): `StringLiteral` 27, `ArrayDeclaration` 11,
`BlockStatement` 10, `ObjectLiteral` 9, `ConditionalExpression` 9, `BooleanLiteral` 6,
`EqualityOperator` 2, `OptionalChaining` 1. Read by *cause*, they are not 58 independent judgements
— they are four families repeated:

1. **Exhaustive `switch` arms that yield nothing** (~20). Emptying a `case` label or its body still
   returns `undefined`, because these switches have no `default` and control falls out to the
   function's implicit tail return. The labels are the *compile-time* exhaustiveness pin, so rung 3
   (delete) does not apply and no runtime test can distinguish them.
2. **Type-narrowing operands on discriminated unions** (now ~2 waived, 16 recorded as survivors
   instead). `state.phase === 'applied' && state.remediation?.status === s`, where `remediation` is
   declared on `AppliedState` alone: the second operand reads `undefined` on every other member, so
   the conjunction is false either way. The operand exists to satisfy the type checker, not to
   decide anything. **This family cannot be waived at line granularity at all** — see the scope
   audit above — so it is now carried in the recorded-survivor table rather than by directives.
3. **Defaults feeding a duck-typed pipeline** (~12). `x ?? []` mutated to `['Stryker was here']`,
   where the pipeline immediately reads a property a string does not have, so the injected element
   contributes exactly what an empty array does.
4. **Third-party normalizations** (~4). `setEncoding('utf8')` → `setEncoding('')` is equivalent
   because Node's `StringDecoder` normalizes a falsy encoding to `utf8` (verified empirically, not
   argued); `branded<T>(x)` is the identity at runtime, so a brand-lift ternary's arms agree.

Families 1 and 2 together are more than half the total, and both are *structural properties of how
this codebase is written* — closed unions with exhaustive matchers, and narrowing operands on those
unions — i.e. exactly the shape D6 and D7 were: a class of finding that is false for a reason that
will not stop being true. The doctrine's own remedy for that is a **configured rule carrying its
reason**, not a comment at each of N sites, and this repo already has the machinery
(`scripts/mutation/ignore-logging.mjs` is a local ignore-plugin with its own test).

**RETRACTED — this recommendation is false, and was disproved by experiment; see "Measured: no
Stryker mechanism can suppress one mutant of a node" below. An ignore-plugin is consulted per AST
NODE before mutants exist, so it cannot leave a killable sibling on the same node measured. The
paragraph is kept, struck, because the reasoning that produced it is instructive.** ~~an `ignore-unions` plugin
retiring families 1 and 2 at the config site under the D6/D7 argument, which would take the inline
waiver count back to roughly 25 *and* clear seventeen of the recorded survivors — an ignore plugin
is handed the babel path, so it can ignore the narrowing operand alone and leave the killable
sibling on the same line measured, which is precisely what a line-scoped comment cannot do. That is
a rule-pack decision with its own false-negative cost (it
would also hide a genuinely wrong `case` grouping), so it deserves its own change and its own
grilling rather than being smuggled in here.~~ Until then the 58 stand, individually justified — each
verified to silence only mutants that genuinely survive.

- **`decider-properties` did what it claimed.** Even before this burn-down the deciders and their
  state folds were the *cleanest* code in the repo by this measure — 5/5/4 survivors against 45 for a
  single adapter mapping file. The naive expectation that deciders would dominate was wrong.
- **The survivors concentrated in adapters** (210 of 464 across both packages) — where the
  tolerant-reader assertions live, which argues *for* D3's decision to keep adapters in scope.
- **Scoped and full runs agree.** The PR job's whole correctness argument is that
  `--mutate <changed files>` gives the same verdict as the full run. Verified repeatedly during the
  burn-down: every file burned to zero under a scoped run reported zero again inside the full run.
- **A scoped run is cheap.** Re-running one file under the shipped config takes 8–30 seconds against
  the full run's ~5–7 minutes, which is what made a 62-file triage practical at all.

### D3 meets D7: the ACL schemas are in scope but unmeasurable

An interaction worth naming, because it undercuts part of D3's rationale. Every consumer-contract
schema (`adapters/*/schemas.ts` in both packages) is a top-level `z.object({…})`, so **every**
mutant in them is static — and D7 therefore ignores all of them. Measured: 65 mutants across the
four schema files, 65 `Ignored`, zero killed, zero survived.

So while adapters *are* in mutation scope, the anti-corruption layer itself — the one place
tolerant-reader strength actually lives — is currently outside the measurement, and a PR touching
only a schema file runs the job and passes having audited nothing. The summary no longer lets that
read as a clean bill: `summarizeSurvivors` reports the analysed and ignored counts, and says
outright when every mutant in scope was ignored. Recorded as a deferred item alongside D7's other
blind spot; the fix is upstream (per-mutant module reloading in the vitest runner), not a config
we can write today.

## The v3.18.0 burn-down: 64 → 27, and the measured limit of precise suppression

**7100 mutants, 929 ignored, 6083 killed, 61 timed out, 27 surviving — 99.56%.**

Re-measured after the rebase onto the current main and after two changes this pass had drafted were
dropped on review (see "What the review sweep found"), so this is the figure for the tree that
actually ships, not the one the burn-down ended on. It supersedes an earlier draft of this section
that said **25 / 99.59%**: that number predated the two mutants deliberately *re-admitted* below when
a score-driven assertion was reverted, and the survivor table underneath has listed 27 rows since.
The headline was simply never updated to match its own inventory — the exact drift
`docs/research/blocking-mutation-gate-scope.md` §10 catalogues, committed here and corrected here.
Timeout counts move a little run to run (71 in one earlier run, 61 in this one); survivors did not.

The 45 that arrived
with v3.18.0 are down to 9; the album-title open question is closed; and one of the seventeen
recorded equivalents was retired by respelling. The remaining **27 are all provably equivalent, and
every one carries a written argument** at its site.

The part worth carrying forward is not the number. It is that this pass **measured** the thing the
previous pass reasoned about — whether any Stryker mechanism can waive one mutant of a node without
silencing its killable siblings. It cannot, and the recommendation this document previously made was
wrong.

### The 45 that came with v3.18.0: 36 killed, 9 equivalent

Not one was a missing feature. Every one was a fact the suite *executed* but could not have noticed
going wrong — the same shape as the pre-rebase burn-down, reproduced on a feature written **after**
the gate existed. That is the argument for task 4.1 restated with fresh evidence: the debt arrives
with the work, so only a diff-time gate meets it at the rate it arrives.

The ones worth naming, because each is a real assertion gap rather than a mutation artefact:

- **`isCycleStart` could decline to answer.** It is declared `: boolean`, but every mutant of its
  exhaustive `switch` — emptying a `case` label, dropping a consequent — makes control fall out and
  return `undefined`. `undefined` is falsy, so no loose assertion could see it, and the outbound
  renderer slices a cycle's story on this answer. Ten mutants, one gap.
- **Both event stores were only ever given `null` as degraded metadata.** `typeof raw !== 'object'
  || raw === null` left four SURVIVORS on one line (it carries about twice that many mutants), and `null` is the single input on which all
  four agree with the original (`typeof null === 'object'`) — which is precisely *why* four sat
  there. A JSON scalar in that column routes down the spread path under three of them and
  manufactures `{0:'g',1:'o',…}`: provenance nobody wrote.
- **A composition root's correlation minter could return `undefined` for every operation.** Every
  existing runtime test either overrode the source or supplied a good story, so the id format
  `runtime.ts` calls the one place to establish was unspecified. Note for anyone re-testing that
  line: reading the story off the outbound feed is a FALSE kill, because the fake supervisor injects
  its own context — only the raw stored row of the submitting hop observes the composed mint.
- **`{ warn: logger.warn.bind(logger) }` emptied to `{}` is not arid.** The verdict consumer calls
  `warn` unconditionally on the unreadable-envelope path, so `{}` throws out through
  `consume`/`drain`/`poll` and **the verdict is never applied**. Reading that object as "just
  logging" would have hidden a real failure path — a caution for D6's blast radius.
- **A verdict could be published under a story opened after it.** The bound keeping the correlation
  envelope "as of the event" could be forced true and no fixture noticed, because none held a
  second cycle.
- **Both renderers could ship `metadata: undefined` instead of omitting the key** — which `toEqual`
  reads as identical — against a serialization convention both files state out loud.

**Six of the 11 that remain are one family with one proof** (the other five carry their own arguments in the table below): the block `correlationOf` builds is immediately
re-validated by `publishedCorrelationSchema`, whose `correlationId` applies the *same*
`CORRELATION_ID_PATTERN` the guard applies, plus a `z.string()` that rejects `undefined`. So
`metadata !== undefined` ⟺ the story is a string matching the pattern, independently of the guard;
every mutation of it changes behaviour only on branches the schema then drops. A side-finding worth
recording: this proves the `!isCorrelationId(story)` half of the guard is **fully subsumed** by the
downstream schema check. It was left in place deliberately — the file's own comment argues the block
should be checked before validation, and deleting it would make the schema solely load-bearing for
that invariant — but it is redundant, and that is a design question for its owner.

### Measured: no Stryker mechanism can suppress one mutant of a node

This document previously recommended an **ignore-plugin** as the right fix for the equivalent
family, on the grounds that a plugin "is handed the babel path, so it can ignore the narrowing
operand alone and leave the killable sibling on the same line measured, which is precisely what a
line-scoped comment cannot do."

**That is false.** Read `@stryker-mutator/instrumenter@9.6.1`
(`transformers/babel-transformer.js`, `transformers/ignorer-bookkeeper.js`): the ignorer is consulted
in `enterNode`, once per AST node, *before any mutant exists*, and the single message it returns is
stamped on **every** mutant **every** mutator generates for that node and its subtree. Its
granularity is the node. A comment directive's is (line, mutator). Neither is (node ∧ mutator), and
nothing composes them — they are `??`-chained alternatives, not filters.

Verified by experiment, not by reading. A throwaway ignore-plugin matched exactly one node — the
`state.phase === 'AwaitingManualSelection'` test in `domain/acquisition/acquisition.ts`, whose
`ConditionalExpression → true` mutant was a recorded equivalent survivor. From the run's own JSON:

| mutant on that node | before | with the node-precise plugin |
| --- | --- | --- |
| `ConditionalExpression → true` | Survived (equivalent) | Ignored — *intended* |
| `ConditionalExpression → false` | **Killed** | Ignored |
| `EqualityOperator → !==` | **Killed** | Ignored |
| `StringLiteral → ""` | **Killed** | Ignored |

The file's score went 96.67% → **100.00%** by hiding three findings the suite was catching. That is
the same false-100% the first draft of this document shipped, reproduced under the mechanism
recommended to prevent it.

Generalised across the whole list rather than assumed: **38 of the 64 survivors sat on an AST node
that also carries a killed mutant** — including **17 of 17** of the equivalent-narrowing family. For
those, a node-precise waiver is strictly worse than no waiver. The `ignore-unions` plugin this
document recommended should **not** be built.

### One was retired by spelling, and that is the test for whether a rewrite is honest

`acquisition.ts`'s snapshot menu guard now asks `'candidates' in state` — the way the three
properties directly above it already ask. `in` is not an operator either mutator rewrites, so the
equivalent mutant does not exist, while the mutant that carries the behaviour (emptying the property
name so the menu is never carried) remains and is killed.

Measured: **30 mutants with 1 unkillable survivor → 27 mutants with none.**

Worth stating as a rule, because the same move done badly is indistinguishable from gaming — and the
first draft of this paragraph stated the rule in a form its own example fails, which review caught:

> **A rewrite that removes an equivalent mutant must not leave any behaviour at the site unmeasured
> that was measured before.**

*Not* "must not reduce the count of killed mutants", which is what this said first. The count at this
site did fall, 3 killed → 1: the `===` spelling produced `ConditionalExpression → false`,
`EqualityOperator → !==` and `StringLiteral → ""`, and the `in` spelling produces only the
`StringLiteral`. The rewrite is still sound, but it takes the finding-level argument to show it: all
three of those mutants were killed by the *same single assertion* — `exposes the retained candidate
editions while awaiting a choice` (read-models.test.ts) — because each of them blanks the menu, and
the surviving `StringLiteral` mutant blanks it too. One behaviour, one assertion, still measured.
A count-based rule would have waved that through on the wrong evidence and, worse, would license a
future rewrite that hides a *distinct* finding as long as the arithmetic came out.

The respelling also moved an invariant from the compiler's keeping into the fold's, which review
flagged and which is now closed: `'candidates' in state` equals the phase test only because every
exit from `AwaitingManualSelection` drops the key, and six other arms of `evolve` use the
`{ ...state }` form that would not. That is asserted over every reachable history by `carries
'candidates' on no state but AwaitingManualSelection` (state.property.test.ts) — written red-first
against a hand-introduced `{ ...state }` cancel arm, which it catches and **no other test in the
suite does.**

The other sixteen were left alone, on purpose:

- The **decider and state-fold phase guards** (`decide.ts` ×2, `state.ts`) could take the same
  treatment and should not. Rewriting a decider's phase guard as a property-presence test costs the
  domain reader more than the score is worth — the phase name *is* the ubiquitous language there.
  This repeats the previous pass's judgement rather than overturning it inside a burn-down.
- The **brand-lift ternaries** (`facade/mapping.ts`, `bridge-adapter.ts`) would need
  `toPositiveInt`/`branded` widened to accept `undefined`. Declining was right, but review corrected
  the reason, and the corrected one is worth having: the dependency-rule argument first recorded here
  is the *weakest* of the three, because widening a signature teaches the domain nothing about the
  adapter. The real arguments are (a) **contract fidelity** — `toPositiveInt`'s docstring says "call
  it only where the wire schema has already proven the value a positive integer", and an
  `undefined`-tolerant mode dilutes it from guardian-of-an-invariant to guardian-plus-optionality-
  passthrough; and (b) decisively, `bridge-adapter.ts` does not call a purpose-built mint at all — it
  calls `branded<T>` directly, which `brand.ts` declares **the single sanctioned cast** in the
  system. Widening *that* hands every brand in both packages a nullable lifting mode nobody asked
  for, and weakens the one function whose narrowness is the entire guarantee that a branded value can
  only originate from a proven invariant. Two equivalent mutants are nowhere near that price.
  Note also that both mutants are equivalent *precisely because* the brand is runtime-erased: the
  ternaries exist for the type checker alone. Reshaping a domain contract to delete a type-level-only
  ternary would be letting the measurement tool author the domain.
- The rest have no spelling that removes the equivalent mutant without either inventing a helper
  whose only motive is the tool, or deleting a guard the type checker requires.

### The authoritative survivor list (25, current at HEAD)

Regenerate with `pnpm exec stryker run`. Every row is provably equivalent with its argument written
at the site; none is an unexamined leftover.

| Site | Mutated span → | Family |
| --- | --- | --- |
| `downloader/interfaces/contracts/events/mapping.ts:23` ×3 | `story === undefined` → false; whole guard → false; `\|\|` → `&&` | subsumed by the schema re-validation |
| `downloader/interfaces/contracts/events/mapping.ts:109` | `block === undefined` → false | `safeParse(undefined)` fails either way |
| `downloader/interfaces/contracts/events/mapping.ts:111` | `metadata === undefined` → false | `{…, metadata: undefined}` is byte-identical on the wire |
| `importer/interfaces/contracts/events/mapping.ts:46` ×3 | as above | subsumed by the schema re-validation |
| `importer/interfaces/contracts/events/mapping.ts:111` | `block === undefined` → false | `safeParse(undefined)` fails either way |
| `importer/interfaces/contracts/events/mapping.ts:113` | `metadata === undefined` → false | `{…, metadata: undefined}` is byte-identical on the wire |
| `importer/interfaces/contracts/events/mapping.ts:43` | `<=` → `<` | versions are unique; the equal case is `stored`, never a cycle start |
| `downloader/adapters/musicbrainz/mapping.ts:334` | `count < modal` → `<=` | map keys are distinct, so `count === modal` cannot hold |
| `downloader/adapters/slskd/client.ts:141` | `body !== undefined` → true | `JSON.stringify(undefined)` is `undefined`; fetch sends no body |
| `downloader/adapters/slskd/poll.ts:28` | `filename !== undefined` → true | `Set<string>.has(undefined)` is false |
| `downloader/application/projections/read-models.ts:329` | `streamId !== undefined` → true | `undefined` in a `Set<string>` no `isStalled(string)` can query |
| `importer/application/projections/read-models.ts:280` | `streamId !== undefined` → true | as above |
| `importer/application/projections/read-models.ts:182` | `type === 'ImportRequested'` → true | `source` is declared on that member alone |
| `importer/application/projections/read-models.ts:215` | `directory === undefined` → false | no open review can reach it without a directory |
| `downloader/domain/acquisition/decide.ts:333` | `phase !== 'Fulfilled'` → false | `resume` is declared on `FulfilledState` alone |
| `downloader/domain/acquisition/state.ts:339` | `phase !== 'Fulfilled'` → false | as above |
| `importer/domain/import/decide.ts:250` | `phase !== 'awaiting-review'` → false | `settled` is declared on that phase alone |
| `downloader/domain/policy/policies.ts:69` | `timeBudgetMs !== undefined` → true | `undefined <= 0` is false |
| `downloader/domain/ranking/ranking.ts:48` | `>` → `>=` | equal ranks give the same answer to every consumer |
| `downloader/domain/shared/duration.ts:25` | `actualMs !== undefined` → true | the tolerance check answers false for `undefined` |
| `importer/facade/mapping.ts:51` | ternary test → false | the brand lift is the identity at runtime |
| `importer/adapters/beets/bridge-adapter.ts:97` | ternary test → false | as above |
| `importer/application/import/use-cases.ts:118` | ternary test → false | the missing id would miss in the projection anyway |

### What the review sweep found, including a live defect

Eleven reviewers ran over this pass. Three findings are worth carrying, because each is a way a
mutation burn-down specifically goes wrong.

**A live, reachable crash — found by reviewing the burn-down's own new test.** Both event stores'
`parseMetadata` returned a non-object metadata column "exactly as found", and one of the tests added
here pinned that for a JSON *scalar*, where it genuinely degrades (`'gone'.correlationId` is
`undefined`). `null` is the one value for which it does not: `continueFrom` opens with
`stored.metadata.correlationId`, so a metadata column holding JSON `null` throws a `TypeError` out of
an unawaited `drain()` as an unhandled rejection and takes the runtime down — the exact wedge that
guard exists to prevent, arriving by the other door. Reachable: DB surgery on the event store is a
documented ops procedure here, and the pre-existing test wrote that value and asserted only
`isOk()`. Every non-object now reads as a row carrying **no** provenance. The lesson is the sharper
half: a *strengthened* assertion and a rewritten comment made the untouched hole look covered.

**A test written for the score, caught and reverted.** The burn-down killed a mutant with
`expect('metadata' in rendered).toBe(false)`, justified as the serialization convention "on the
wire". Two reviewers independently showed the justification is false — `JSON.stringify` drops an
`undefined` property, so the two shapes are byte-identical; `OutboundFeed` re-adds the key
unconditionally one layer out; and no consumer reads a published event with `in` or `Object.keys`.
It pinned a distinction nothing can observe. Reverted to `toBeUndefined()`, and the two mutants are
recorded as equivalent survivors instead. This is the rule working as intended: the honest answer
cost two points of score, and the reviewer that found it is the one this document predicted would
(`design.md` Risks: "test-quality-reviewer already hunts refactoring-brittle tests").

**A fix that removed a right answer with the wrong one.** Recorded above under the album-title
question. Three reviewers converged on it; the shipped fix now keeps punctuation-titled albums
findable, and a test pins that they are.

Also worth noting for the next pass: the `--tempDirName` glob was widened in `stryker.config.mjs`
but not in `.gitignore`, `.prettierignore`, or `eslint.config.js` — and **jj snapshots the working
copy against `.gitignore`**, so an un-ignored sandbox (a full copy of the tree) would have been
auto-added to the working-copy commit. Fixing a hazard in one of four places is its own failure mode.

### Why the gate still stays inert — and why waiting for a clean main is not the plan

Main is **not** mutant-clean, so `continue-on-error` stays on the PR job's Stryker step and task 4.1
stays open. Flipping it while these survivors sit on main would block the next unrelated PR on debt
it did not create, which is exactly what D5's ordering exists to prevent.

**But D5's ordering rests on a premise that is now retired.** D5 sequences the flip *after* "main
becomes mutant-clean", and `docs/research/blocking-mutation-gate-scope.md` establishes — from the
literature, not from this repo's experience — that such a state is unreachable in principle: the
equivalent fraction among survivors **rises** as the suite improves. Read that doc rather than this
paragraph; it is the authority, and §5.1 and §9 carry the argument and its sources. The consequence
for this change is blunt and belongs here: **task 2.1's exit criterion can never be met, so any plan
whose next step is "finish the burn-down" is planning against a state that does not exist.** Three
passes have now driven the list down by hand (464 → 19, then 64 → 27) and the gate has blocked
exactly nothing.

**The adopted direction is `openspec/changes/mutation-gate-diff-scope/`** — move the failure scope
from changed *files* to changed *lines*, shipped in shadow mode behind `MUTATION_GATE_ENFORCE`, with
a measured false-positive rate as the gate to enforcement. That change owns the pipeline job from
here on: the survivor forgiveness, the timeout, the verdict, and the comments that argue them. This
document deliberately makes no further edit to `.github/workflows/pipeline.yml`, so that the two
changes cannot contradict each other in the same file. Under that design `continue-on-error` **moves
rather than disappears** (diff-scope D5), which is why it is still on the Stryker step here.

**One hazard found in this pass and deliberately left for that change to fix.** `continue-on-error:
true` covers the whole step, so it forgives Stryker *crashing* exactly as readily as it forgives
survivors — a config error, an OOM, a plugin that failed to load, or a corrupted sandbox all leave a
green job indistinguishable from a clean run. That is the one failure mode a gate must not have, and
it is not hypothetical here: the sandbox-nesting bug recorded below produced a **confidently wrong
score** rather than an error. Two notes for whoever implements it:

- **The weekly workflow already solved this and nobody cited it.** `.github/workflows/mutation.yml`
  carries an "Assert the run produced an inventory" step whose comment states the rule exactly —
  `continue-on-error` must cover the expected non-zero exit and nothing else. The PR job has no
  equivalent. The asymmetry, not the mechanism, is the finding.
- **Exit code alone is not enough**, measured here: a Stryker `ConfigError` propagates as an
  unhandled rejection and node also exits 1, so a crash and a missed threshold are the same code.
  The reporters run before the threshold is evaluated, so the presence of `reports/mutation/
  mutation.json` is what separates them. Diff-scope D4 already requires the verdict to fail on a
  missing or unreadable report; that condition is the same test, and it is the one to reuse.

Worth stating plainly, because shadow mode hides it: until diff-scope's verdict step is *enforcing*,
this hazard remains open. The gate can still green on its own breakage.

### D8 — RECOMMENDED, NOT IMPLEMENTED: a justified survivor baseline, checked by the job

**Partly superseded.** Line-scoped failure (`mutation-gate-diff-scope`) is the adopted answer to the
question this decision was reaching for, and it retires the *blocking* motive: a mutant on a line no
PR touched cannot fail that PR, so the equivalents below stop being a gate to arm rather than a debt
to clear. The inventory idea survives only as a way to keep the equivalence *claims* audited, which
is a smaller job than the one described here. Read the rest as the reasoning that ruled out the
alternatives, not as a live recommendation.

The only mechanism that can arm this gate honestly is one Stryker does not offer and does not need
to: **a checked-in inventory of the known-equivalent survivors, compared against the run's JSON
report by the job itself.** The job fails on any surviving mutant *not* in the inventory and passes
the ones that are. The report parser it needs already exists (`scripts/mutation/report-model.ts`).

Why this is the right rung, in the doctrine's own terms:

- It is **precise to (file, line, mutator, replacement)** — finer than anything Stryker offers — so
  it is structurally incapable of the collateral damage measured above. It cannot silence a killable
  twin, because it names the exact replacement.
- Each entry carries **a written justification**, the shape the waiver doctrine asks for, and the
  entries are **countable** — so `mutation-scope.test.ts` can hold a ceiling on them exactly as it
  does for `// Stryker disable` directives today: a number to drive down, never a budget to spend.
- It is the standard adoption pattern for a strict analyser over an existing codebase (PHPStan's and
  Psalm's baselines, ESLint's suppressions file). That is a point in its favour and also its danger:
  **a baseline allowed to grow is exactly the attested-dead shape it exists to escape.** The ceiling
  test is what makes it a ratchet rather than a dumping ground.

It is deliberately **not implemented here.** It is a rule-pack decision with a real false-negative
cost — a wrongly-justified entry stops being audited until someone re-reads it — and this document
has now twice recorded a mechanism adopted on an argument rather than a measurement. It deserves its
own change and its own grilling. What this pass contributes is the measurement that rules out the
alternatives, so that grilling can start from evidence.

### Two operational findings, both of which produced confidently wrong readings

- **Custom sandbox directories nest.** A Stryker run ignores whatever `tempDirName` is set to —
  **its own**, and only its own. So two concurrent runs given different `--tempDirName` values (the
  way concurrent scoped triage avoids cross-corruption) each copy the *other's* sandbox into theirs,
  recursively:
  `.stryker-tmp-a/sandbox-x/.stryker-tmp-b/sandbox-y/…`. It does not fail loudly — it reports a
  plausible wrong score (73 survivors in a file that has none) and then dies on `ENOENT` inside a
  path it had just built. Fixed by an `ignorePatterns` glob covering every spelling.
- **The config file is a positional argument**, not `-c`/`--configFile`. `stryker run -c other.mjs`
  silently runs the DEFAULT config, which is how the first attempt at the experiment above produced
  a confident "the plugin does not fire" that was purely an artefact of the flag being ignored.

## Open Questions

- **Task 3.3 is now measured in CI, not just locally.** This change's own PR (#161) exercised the
  job on a real 2-file production diff (`quality-policy.ts`, `import/decide.ts`): the whole job took
  **2m31s** on a 4-core runner, of which the Stryker pass was **~1m43s** — 372 mutants, 359 killed,
  13 surviving, at 5.08 tests per mutant. Comfortably inside the 20-minute timeout, so no tuning
  lever was needed — but that run is the **smallest** of three now observed, and reading it as
  representative is a mistake `docs/research/blocking-mutation-gate-scope.md` §10 catalogues by name.
  The other two are recorded there. The ceiling is left at 20 by this change and raised by
  `mutation-gate-diff-scope` (its task 3.4), which owns the job. Levers if a larger diff ever needs
  them remain `--concurrency` (D4) first, then narrowing `mutate` to changed line ranges rather than
  changed files — which is now the adopted direction rather than a lever.

  Two things that run confirmed beyond the timing. The scope resolution picked out exactly the two
  changed production files and nothing else. And the job **passed while Stryker exited 1** — the
  `continue-on-error` arrangement behaves as designed: the findings are reported in the step summary
  and the check stays green. (That observation stands; "until task 4.1 flips both together" no longer
  does — see "Why the gate still stays inert".) `decide.ts`'s 13 survivors in CI
  match the 13 measured locally, which is a second confirmation that scoped and full runs agree. Re-measure on the first PR
  that actually changes production code.
