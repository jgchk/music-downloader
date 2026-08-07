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
is suppressed at the site with that reasoning written out, and it is the one waiver in the repo —
which also means `mutation-scope.test.ts`'s justification scan now runs over a real suppression
rather than an empty set.

No test was written to feed the gate. Every test above pins a behavior a competent reader would
want asserted, and all of them passed on first run against unmodified production code — the code
was right, the tests were weak.

## The burn-down is NOT complete — 464 survivors remain

Task 2.1 asked for a repo-wide triage to mutant-clean. That was not achieved, and the shortfall is
recorded here rather than narrowed away. After D6 and D7 removed the two false-finding classes and
the kills above landed, the honest remaining inventory is 464 surviving mutants across 62 files:

| Layer | Survivors |
| --- | --- |
| downloader/adapters | 186 |
| downloader/application | 71 |
| importer/application | 53 |
| downloader/domain | 42 |
| importer/domain | 36 |
| importer/adapters | 24 |
| importer/composition | 18 |
| downloader/facade | 17 |
| downloader/composition | 13 |
| importer/facade | 3 |
| importer/interfaces | 1 |

The heaviest single files are `downloader/src/adapters/musicbrainz/mapping.ts` (45),
`importer/src/application/import/reactor.ts` (33),
`downloader/src/application/acquisition/reactor.ts` (27),
`downloader/src/adapters/ffmpeg/probe.ts` (21) and `downloader/src/adapters/slskd/download.ts` (19).
Regenerate the full inventory at any time with `pnpm exec stryker run` — deliberately not frozen
into this document, because a stale copy is worse than the command that reproduces it.

Three observations worth carrying forward:

- **`decider-properties` did what it claimed.** The deciders and their state folds are the
  *cleanest* code in the repo by this measure — `downloader/src/domain/acquisition/decide.ts` has 5
  survivors, `state.ts` 5, `react.ts` 4, against 45 for a single adapter mapping file. The naive
  expectation that deciders would dominate the survivor list was wrong.
- **The survivors concentrate in adapters** (210 of 464 across both packages). That is where the
  tolerant-reader assertions live, and it argues *for* D3's decision to keep adapters in scope.
- **Scoped and full runs agree.** The PR job's whole correctness argument is that
  `--mutate <changed files>` gives the same verdict as the full run. Verified on the worst file:
  `musicbrainz/mapping.ts` reports 45 survivors both scoped alone and inside the full run.

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

## Open Questions

- **Task 3.3 is now measured in CI, not just locally.** This change's own PR (#161) exercised the
  job on a real 2-file production diff (`quality-policy.ts`, `import/decide.ts`): the whole job took
  **2m31s** on a 4-core runner, of which the Stryker pass was **~1m43s** — 372 mutants, 359 killed,
  13 surviving, at 5.08 tests per mutant. Comfortably inside the 20-minute timeout, so no tuning
  lever was needed. Levers if a larger diff ever needs them remain `--concurrency` (D4) first, then
  narrowing `mutate` to changed line ranges rather than changed files.

  Two things that run confirmed beyond the timing. The scope resolution picked out exactly the two
  changed production files and nothing else. And the job **passed while Stryker exited 1** — the
  `continue-on-error` arrangement behaves as designed: the findings are reported in the step summary
  and the check stays green until task 4.1 flips both together. `decide.ts`'s 13 survivors in CI
  match the 13 measured locally, which is a second confirmation that scoped and full runs agree. Re-measure on the first PR
  that actually changes production code.
