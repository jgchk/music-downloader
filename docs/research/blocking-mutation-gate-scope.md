# What failure scope should a blocking per-PR mutation gate use, and what do you do about legacy and provably-equivalent survivors?

**Research date:** 2026-08-07. All URLs accessed 2026-08-07 unless noted. Findings are input to a
decision, **not normative until adopted** through an OpenSpec change and a PR.

**Question.** A StrykerJS mutation gate runs per-PR in `.github/workflows/pipeline.yml`, scoped to
the production **files** a branch changed, with `continue-on-error: true` and no required-check
flag. The owner wants it to genuinely block. `main` is not mutant-clean and — as the shipped design
now documents — cannot honestly reach 100%. So: what **failure scope** should a blocking gate use,
and what happens to legacy survivors and to provably-equivalent mutants that cannot be waived
without silencing a killable twin? Six options were on the table: (1) changed-line/diff-hunk failure
scope, (2) a committed accepted-survivor baseline, (3) refactoring equivalents onto their own lines,
(4) a node-precise ignorer plugin, (5) a percentage `thresholds.break`, (6) `--incremental` against a
main baseline.

**Method.** Repo state verified directly against `main` (`git show main:…`; the local working copy
is behind), not taken from the prompt: `.github/workflows/{pipeline,mutation}.yml`,
`stryker.config.mjs`, `scripts/mutation/*`, `test/boundaries/mutation-scope.test.ts`,
`openspec/changes/mutation-gate/{proposal,design,tasks,specs}`, `docs/development/quality-gates.md`,
`docs/development/testing.md`, `CLAUDE.md`. CI wall-clock read from the GitHub Actions API
(`gh api …/actions/runs/<id>/jobs`) for three real runs rather than from the design doc's single
measurement. Primary sources fetched 2026-08-07: the StrykerJS documentation and the
`stryker-mutator/stryker-js` source and issue tracker (via `gh api` / `gh search issues`, so GitHub's
own index rather than a web search of it); the mutation-testing-elements report schema; Google's
ICSE-SEIP 2018 paper read **in full from the PDF** (not from the prior doc's summary), plus TSE 2021
and ICSE 2021 in full and Papadakis et al. ICSE 2018 in full; Budd & Angluin 1982, Jia & Harman 2011,
Schuler & Zeller 2010 and the mutant-subsumption papers;
arcmutate, pitest, Mull, Cosmic Ray, mutmut and Stryker.NET documentation;
Sonar, Codecov, GitLab, golangci-lint, diff-cover, undercover; PHPStan, Psalm, ESLint bulk
suppressions, Android lint, Checkstyle, Error Prone, NullAway, betterer. Sub-agents did the breadth
sweeps under a "quote-or-say-you-couldn't-reach-it" contract; the load-bearing facts (mutation
ranges, the directive keying, Google's blocking question, arcmutate's default scope, the CI timings)
were re-verified first-hand. Citations inline; sources in §12. Unreachable pages are named in §12.

This doc **builds on** `docs/research/automated-quality-function.md` §5.1 and does not re-argue it;
where shipping the gate revealed that doc's conclusions need amending, §9 says so explicitly.

---

## 1. House facts being decided against (verified on `main`)

- **The job.** `.github/workflows/pipeline.yml` job `mutation`: `if: github.event_name ==
  'pull_request'`, `timeout-minutes: 20`, scope resolved by `git diff --name-only --diff-filter=ACMR
  $(git merge-base …)` filtered to `^packages/(downloader|importer)/src/….ts$`, then
  `pnpm exec stryker run --mutate "$MUTATE"` under `continue-on-error: true`. A following step
  (`if: always()`) writes `scripts/mutation/report.ts` output to the step summary. Confirmed.
- **The rationale is conditional on a false precondition.** The job's comment block justifies file
  scope with: *"once main is mutant-clean, a changed file's untouched lines carry no survivors, so
  the two give the same verdict — and file scope additionally catches a change that weakens an
  assertion elsewhere in the same file."* Main is not mutant-clean, and §5 establishes it cannot
  become so by any mechanism currently shipped: equivalence is undecidable, StrykerJS offers no
  per-mutant suppression, and the one route that would work (an ignorer plugin) is an unwritten
  deferred item. The identity the argument rests on is unavailable, so "stricter and far simpler"
  reduces to "stricter" — i.e. it fails branches on debt they did not create.
- **The spec was amended to match the code, not the other way round.**
  `openspec/changes/mutation-gate/specs/mutation-testing/spec.md` ADDs *"The PR gate SHALL run
  mutation testing over the branch's changed production **lines**"* and then MODIFIEs it to
  *"changed production **files**"*, with the same conditional justification. Line scope was the
  drafted requirement.
- **The measurement.** `design.md`'s rebase table records, at the tip that became `main`: **7088
  mutants, 929 ignored, 64 surviving, 98.96%** (the detected split — 6028 killed + 67 timeout —
  reconciles: 7088 − 929 − 64 = 6095). Of the 64: **~45 arrived with the v3.18.0 correlation
  feature**, in production code that change added; **17** are provably-equivalent narrowing operands
  **deliberately left unwaived**; **2** are a real unspecified-behaviour finding in the MusicBrainz
  album path. The 45 are the single most instructive fact in the whole file: a one-day burn-down took
  464 → 19, and one unrelated feature put 45 back inside a week. **Mutation debt is a flow, not a
  stock** — which is an argument *for* a diff-time gate and *against* ever expecting a clean main to
  be the precondition for one.
- **The blocking obstacle, verified in Stryker's source.** `// Stryker disable` keys on *(line,
  mutator name)* and nothing else — `DirectiveBookkeeper`'s `IgnoreRule.matches()` is
  `lineMatches() => this.line === undefined || this.line === line` AND `mutatorNames.includes(
  mutatorName) || mutatorNames.includes('all')`
  ([directive-bookkeeper.ts](https://github.com/stryker-mutator/stryker-js/blob/master/packages/instrumenter/src/transformers/directive-bookkeeper.ts)).
  There is no column, no node identity. So waiving one operand silences every mutant that mutator
  emits on the line — and `ConditionalExpression` emits `true` *and* `false` from one node, so the
  equivalent and its killable twin are co-located by construction.
- **The prior failure this caused.** A first pass reported 99.89% / 6 survivors. It was false: two
  block-form `disable` … `restore all` pairs never closed, because Stryker reads only a node's
  *leading* comments and both `restore`s sat as the last token inside a `case`. Suppression ran to
  end-of-file, silencing 96 mutants across `read-models.ts` and `effect-lander.ts` — including the
  whole retry-vs-dead-letter landing decision — while both files reported 100.00. Fifteen further
  waivers were silencing killable twins. 104 of the 206 silenced mutants turned out to be killable.
  `test/boundaries/mutation-scope.test.ts` now bans the block form outright and pins a suppression
  ceiling of **58 directives / 75 mutants**.
- **Suppression is already at the doctrine's own alarm threshold.** `quality-gates.md`: *"a rising
  suppression count is the signal that the rule failed admission and nobody noticed."* 1 → 58 in one
  change. `design.md` records this rather than absorbing it, and already recommends the fix (an
  `ignore-unions` ignorer plugin) as a deferred item with its own change.
- **Measured CI cost — three real runs, read from the Actions API, not projected.** The job's own
  comment still says `# projected low-minutes on a 4-core runner; NOT yet observed in CI`; it has
  now been observed three times:

  | PR | changed prod files | Stryker step | whole job |
  | --- | --- | --- | --- |
  | mutation-gate's own (#161) | 2 | 1m43s | 2m32s |
  | v3.18.0 correlation | 53 | 8m54s | 9m37s |
  | the burn-down | 36 | **13m16s** | **13m58s** |

  Against `timeout-minutes: 20`. Cost is **not** linear in file count — it is mutants × tests per
  mutant, and the burn-down's 36 domain/adapter files are far more densely covered than the
  correlation change's 53. Sibling jobs on the same run: `quality` **1m16s**, `test` **2m04s**,
  `version-check` 19s.
- **Latency consequence, stated up front.** Making `mutation` required moves the PR critical path
  from ~2 minutes to ~14, a **~7×** increase, and puts a job with 30% timeout headroom on the merge
  path. `quality-gates.md`'s latency budget explicitly exempts CI from the seconds-order rule, so
  this violates no non-negotiable — but it is the largest single cost of the flip and is currently
  unrecorded anywhere.

## 2. What the tool can actually do (StrykerJS primary sources)

This section exists because three of the six options turn entirely on tool capability, and two of
those capabilities were assumed rather than checked.

### 2.1 StrykerJS supports line-range mutation natively — the decisive fact

The config docs: *"It is possible to specify exactly which code blocks to mutate by means of a
_mutation range_. This can be done postfixing your file with `:startLine[:startColumn]-endLine[:endColumn]`."*
Documented examples: `"src/app.js:1-11"`, `"src/app.js:5:4-6:4"`, `"src/app.js:5-6:4"`
([configuration](https://stryker-mutator.io/docs/stryker-js/configuration/)). Shipped in **v4.6.0**
(2021-04-16, [PR #2751](https://github.com/stryker-mutator/stryker-js/pull/2751)).

Constraint: *"It is **not** possible to combine mutation range with a globbing expression in the
same line."* The validation is **per array element** — `options-validator.ts` throws *"Config option
"mutate[${index}]" is invalid. Cannot combine a glob expression with a mutation range"* — so a
comma-separated list of explicit `path:start-end` entries (which is exactly what the job already
builds) is valid.

**And the maintainer explicitly recommends this for diff gating.** On
[issue #2843](https://github.com/stryker-mutator/stryker-js/issues/2843) ("Generate mutant only for
the changed lines in a range of commits"), nicojs (2021-07-05): *"We've recently added support to
mutate a specific range only… Example: `stryker run --mutate foo.js:25-30`. This can be combined
with some kind of pipeline git diff command."* Earlier, on
[#551](https://github.com/stryker-mutator/stryker-js/issues/551) ("Mutate only modified files (based
on git)"), he rejected building git in: *"I wouldn't want to use git as a source of files, as it
would tightly couple with it."* So: **no native `--since`, by deliberate design, with the
range syntax as the sanctioned substitute and the diff computation left to the caller.** The
repo's merge-base shell step is precisely the sanctioned shape; it is just resolving to files
instead of ranges.

**One semantic trap, verified in source.** Range filtering uses *containment*, not overlap:
`babel-transformer.ts`'s `shouldMutate` requires `locationIncluded(range, path.node.loc)`, i.e. the
mutant's whole node must sit inside the range. A `BlockStatement` mutant spanning an entire function
is therefore **not generated** when only one line inside it changed. That matters: in Google's data
`SBR` (statement block removal) is **72.18%** of all mutants and *"the mutation type second-least
likely to survive"* (ICSE-SEIP 2018, Fig. 5 and §5.3). Strict range scoping silently drops the
biggest and bluntest mutant family. §9 recommends around this.

### 2.2 Disable comments: no per-mutant granularity, and none planned

Docs: *"Disabled mutants will remain in your report but will get the `ignored` status."* Block form
*"applies from that point forward until a corresponding restore statement"*
([disable-mutants](https://stryker-mutator.io/docs/stryker-js/disable-mutants/)). Source confirms
matching on `(line, mutatorName)` only (§1). The tracker history:

- [#1472](https://github.com/stryker-mutator/stryker-js/issues/1472) "Ignore specific mutations"
  (2019 → closed 2021-09-01) — resolved by shipping the comment syntax in 5.4.
- [#1174](https://github.com/stryker-mutator/stryker-js/issues/1174) "Ignore Function With Comment" —
  closed, later pointed at the ignore-plugin.
- [#3229](https://github.com/stryker-mutator/stryker-js/issues/3229) "Allow users to ignore mutants
  based on heuristics" (opened by nicojs 2021-10-26, **closed as implemented** 2023-10-14) — this is
  the ignorer plugin, and its body cross-references *"a couple of requests in the past to allow to
  ignore specific mutants: #2966 #1174 #1470 #1464."*
- [#3228](https://github.com/stryker-mutator/stryker-js/issues/3228) — closed in favour of #3229.

**Verdict: there is no mechanism keyed on an individual mutant** (no "suppress mutant with id X", no
mutator+replacement+position key). Every StrykerJS suppression is by *source pattern*: line+mutator
(comment) or AST-node predicate (plugin). The maintainer's consistent answer to "I want finer
control over what gets mutated" is **write an ignorer plugin** — e.g. on
[#4141](https://github.com/stryker-mutator/stryker-js/issues/4141): *"#3229 is probably what you
want."*

### 2.3 The ignorer plugin is the node-precise mechanism, and this repo already ships one

`declareValuePlugin(PluginKind.Ignore, name, { shouldIgnore(path) { return "reason" } })`, where
*"The `path` parameter is a babel `NodePath` object"*
([disable-mutants#using-an-ignore-plugin](https://stryker-mutator.io/docs/stryker-js/disable-mutants/#using-an-ignore-plugin)),
and the interface from #3229 is `shouldIgnore(path: NodePath): string | void`, called *"inside the
instrumenter on each AST node visitation."* Full AST granularity — it can ignore one operand of a
condition and leave its killable sibling on the same line measured, which is exactly what a
line-scoped comment cannot do.

`scripts/mutation/ignore-logging.mjs` is already this, with a test pinning its blast radius. The
machinery for option 4 exists in-repo; only the rule is missing.

### 2.4 `--incremental` cannot be a baseline here, for two independent reasons

Docs: *"StrykerJS will do a git-like diff of your code and test files to the previous version it
finds in the incremental report file"* and the report is the *"full mutation report"*
([incremental](https://stryker-mutator.io/docs/stryker-js/incremental/)). `design.md` D4a already
rejects it for the PR job because the merged whole-repo report re-imports untouched debt into the
verdict. Two additions:

- The docs do **not** state explicitly whether `thresholds.break` applies to the merged whole. The
  sub-agent reported this as an absence rather than inferring it, and I did not find the sentence
  either. D4a's claim is empirically grounded on this repo but is **not** documented upstream — mark
  it as measured-here, not attested.
- **The incremental file is not committable with the vitest runner.**
  [Issue #6004](https://github.com/stryker-mutator/stryker-js/issues/6004) (open, 2026-05-13, filed
  against 9.6.1 — the exact version pinned here): non-deterministic vitest test IDs produce a ~15k
  line diff on every no-op run. *"This is a blocker for storing the incremental baseline in version
  control."* That kills option 6's "baseline against main" framing outright.

  The same issue carries a useful positive: *"Mutant `id` — stable. `status`, `mutatorName`,
  `replacement`, `location` — stable. Test IDs in `killedBy`/`coveredBy` — different on each run."*
  So a hand-rolled baseline keyed on `(file, location, mutatorName, replacement)` **would** be
  run-to-run stable. Note `id` itself is a per-run ordinal (`MutantCollector`'s `nextMutantId++`),
  stable only for byte-identical input — never key a baseline on it.

### 2.5 Score semantics, for option 5

`break`: *"mutation score < break: Error! Stryker will exit with exit code 1"*
([configuration](https://stryker-mutator.io/docs/stryker-js/configuration/)). Mutation score is
`detected / valid * 100` where `valid = detected + undetected`, and the denominator **excludes**
`Ignored`, `CompileError`, `RuntimeError` and `Pending`
([mutant states and metrics](https://stryker-mutator.io/docs/mutation-testing-elements/mutant-states-and-metrics/)).
So today's `break: 100` is exactly "zero survivors among non-ignored mutants", which is what
`design.md` D1 says it is. Full status set: `Pending, Killed, Survived, NoCoverage, Timeout,
RuntimeError, CompileError, Ignored` — `Ignored` is distinct, as `report-model.ts` already assumes.

### 2.6 What a baseline could key on

The [report schema](https://github.com/stryker-mutator/mutation-testing-elements/blob/master/packages/report-schema/src/mutation-testing-report-schema.json)
gives each mutant `id`, `mutatorName`, `replacement`, `location.{start,end}.{line,column}`, `status`,
`statusReason`, `static`, `coveredBy`, `killedBy`, `description`, `duration`. So a baseline keyed on
exact position + mutator + replacement is **mechanically possible** — richer than any in-source
comment can express. Whether it is *wise* is §4.

## 3. Q1 — legacy survivors: is diff/changed-line scoping the established answer?

### 3.1 Google mutates changed **lines**, at most one mutant per line, and does not block

Read from the ICSE-SEIP 2018 PDF directly, not from a summary:

- Scope: *"For each file in the diff, a set of mutants is requested, one for each affected covered
  line. Affected lines are added or modified lines in the diff, and the covered lines are defined by
  the coverage analysis results."* And, decisively: ***"Only lines affected by the diff under review
  that are covered and are not arid are mutated."***
- Density: *"For each line, at most one mutant is generated. Surfacing multiple mutants for a single
  line clutters the code review interface and looks confusing."*
- Deployment: *"the results of the mutation analysis, e.g. living mutants, are surfaced during a code
  review as code findings."* A finding carries *"'Please fix' and 'Not useful' links"*; *"If an
  automated analyzer finding (e.g. a living mutant) is not useful, developers can report that with a
  single click."* Rationale: *"We argue that the code review process is the best location for
  surfacing changed code metrics because it maximizes the probability that the change will be acted
  upon."*
- **Did they ever block? No — and TSE 2021 §2.4 settles it in one sentence:** *"These findings do
  not need to be resolved by the author before submission, unless a human reviewer marks them as
  mandatory."* Blocking, where it exists at all, is a **human** decision on a specific finding, never
  the tool's.
- **Their non-actionable-rate target is the same number as this repo's admission bar.** TSE 2021
  reports mutant *productivity* — the complement of the "Not useful" rate — as *"82% of all reported
  mutants"* aggregate, *"increased over time from 80% to 89%"*, with the stated goal *"to maintain a
  mutant productivity rate around 90%"* and a policy of disabling a mutator on any node type whose
  productivity drops below 80%. So Google, after years of tuning, sits at 82–89% useful against a
  ~90% target — i.e. **hovering at or just under `quality-gates.md`'s ten-percent effective-FP bar,
  with a human "Not useful" button as the release valve.**
- Mutation score, rejected explicitly: *"At present it is infeasably expensive to compute the
  absolute mutation score for the codebase at any given fixed point… In addition to the computation
  costs of the mutation score, we were also unable to find a good way to surface it to the engineers
  in an actionable way."* And *"Living mutants are a precondition for surfacing an actionable
  finding, but alone do not make a good measure of efficacy."*
- Usefulness: *"75% of all findings with feedback were found useful by developers"*; the abstract
  reports *"the reported usefulness of the surfaced results improved from 20% to 80%"* and §6:
  *"we have reduced the probability of non-actionable result rates to 25% manually."*

TSE 2021 restates the same three ideas as the core contribution: *"(1) Mutation testing is done
incrementally, mutating only changed code during code review… (2) Mutants are filtered… limiting the
number of mutants per line and per code review process; (3) Mutants are selected based on the
historical performance of mutation operators"* ([arXiv:2102.11378](https://arxiv.org/abs/2102.11378)).
It also justifies the one-per-line cap empirically: *"In more than 90% of the cases, either all
mutants in a line are killed, or all mutants in a line survive"* — so surfacing more than one is
almost always redundant. **This repo's 17 are the other ≤10%**: a line whose two mutants disagree is
exactly the case Stryker's line-keyed `disable` cannot express.

**And the surfaced volume is tiny.** TSE 2021 §7: the median mutants per changelist falls from
**820** (traditional) to **77** (one per line) to **7** (arid suppression + one per line). Google
gates a human's attention at ~7 findings per review. This repo's blocking gate would surface every
survivor in every changed file, uncapped — 13 on a 2-file diff (`design.md`, PR #161), 45 on the
correlation feature. §9 returns to this.

**So the deviation matters.** `stryker.config.mjs`'s header names two deliberate deviations from the
Google recipe — file scope instead of line scope, and blocking instead of advisory. Both are real
deviations, and the shipped file scope is the one the paper's own sentence contradicts most directly.
The prior research doc's §5.1 summary ("mutate only changed, covered lines") was accurate; the
implementation drifted from it, and the workflow comment's justification for drifting depends on a
precondition that does not hold.

### 3.2 Every other mutation tool that gates on a diff gates on **lines**

- **arcmutate** (the commercial pitest extensions — the only mature *productised* mutation gate):
  *"In change based mode, only code modified between the specified git refs will be analysed"*, and
  the default `scope` is **line** — *"only mutations on lines that have been modified will be
  analysed"* — widenable to `class` as an explicit opt-in
  ([git-integration](https://docs.arcmutate.com/docs/git-integration.html)). *"This mode is designed
  to be used when integrating pitest into pull requests, and for receiving fast feedback on local
  changes."* Their GitHub integration is **advisory by default**: a PR comment plus per-line diff
  annotations, with an optional `LEVEL` parameter (error / **warning, default** / info) that decides
  whether the check run fails
  ([github/overview](https://docs.arcmutate.com/docs/github/overview.html)).
- **Mull** (LLVM/C++): *"Incremental mutation testing is a feature that enables running Mull only on
  the mutations found in Git Diff changesets"*, line-scoped — *"if a Git diff … is only one line,
  Mull will only find mutations in that line"*
  ([docs](https://mull.readthedocs.io/en/latest/IncrementalMutationTesting.html)).
- **Cosmic Ray** (Python): `cr-filter-git` *"looks for edited or new lines from the given git branch.
  Any mutation in a session that would mutate other lines is skipped"*
  ([filters](https://cosmic-ray.readthedocs.io/en/stable/how-tos/filters.html)).
- **Stryker.NET** is the outlier and is the *file*-ish one: `--since` *"Use git information to test
  only code changes since the given target. Stryker will only report on mutants within the changed
  code"*, and for test files *"all mutants covered by tests in that file will be seen as changed"*
  ([stryker-net configuration](https://stryker-mutator.io/docs/stryker-net/configuration/)).
  **StrykerJS has no `--since`** — confirmed absent from its configuration docs; the JS analogue is
  `incremental`, which is a caching mechanism, not a scope.
- **OSS pitest removed its diff support**: the `scm` Maven goal was deprecated (`#1353 Warn about
  future SCM goal removal`, 1.17.1) and *"Fully remove deprecated scm maven goal"* (`#1379`, 1.18.0)
  ([pitest README changelog](https://github.com/hcoles/pitest/blob/master/README.md)). Diff-scoped
  mutation is now a paid feature of the same author's commercial product — which is itself evidence
  of how much demand there is for it.

### 3.3 The coverage-gate analogy: diff scoping is the industry's stock answer for a dirty metric

- **Sonar's "Clean as You Code"** is the strongest official statement anyone makes. The recommended,
  read-only **Sonar way** gate *"focuses on keeping high quality standards for new code, rather than
  spending a lot of effort remediating old code"*
  ([quality gates](https://docs.sonarsource.com/sonarqube-server/quality-standards-administration/managing-quality-gates/introduction-to-quality-gates)),
  and CaYC's framing is *"You aren't responsible for anyone else's code. You own the quality and
  security of the new code you are working on today"*
  ([clean as you code](https://docs.sonarsource.com/sonarqube-server/10.5/user-guide/clean-as-you-code)).
  All four locked conditions are new-code-scoped. Sonar even hard-caps the boundary: *"Code that is
  older than 90 days cannot be considered new."*
- **Codecov** ships exactly the two-status split this decision is about: *"The `codecov/project`
  status measures overall project coverage… The `codecov/patch` status **only** measures lines
  adjusted in the pull request"* ([commit status](https://docs.codecov.com/docs/commit-status)). The
  legacy argument lives on their blog, not the docs [secondary, maintainer-published]: *"the burden
  of writing tests stems away from legacy code"*.
- **golangci-lint** has the full ladder: `new-from-merge-base` — *"Show only new issues created after
  the best common ancestor (merge-base against HEAD)"* — plus a `whole-files` escape hatch, *"Show
  issues in any part of update files"*
  ([configuration](https://golangci-lint.run/docs/configuration/file/)). Note that the tool treats
  **line scope as the default and file scope as the widening**, same as arcmutate.
- **diff-cover**: *"Diff coverage is the percentage of new or modified lines that are covered by
  tests. This provides a clear and achievable standard for code review"* — *"If you touch a line of
  code, that line should be covered"* ([README](https://github.com/Bachmann1234/diff_cover)). Honest
  correction to a tempting citation: its README never says "legacy"; its motivation is
  achievability-in-review, not legacy remediation.
- **undercover** (Ruby) gives a third granularity — changed **methods/blocks** — and is explicit
  about the motive: for *"large or legacy codebases that lack testing"*
  ([README](https://github.com/grodowski/undercover)).
- **GitLab** is the weak case and should not be cited as diff scoping: coverage annotations are
  diff-scoped for *display* (*"Annotations appear only on files that are changed in the MR diff"*)
  but the gate is a delta — the `Coverage-Check` approval rule *"can require approval when coverage
  drops"* ([code coverage](https://docs.gitlab.com/ci/testing/code_coverage/)). That is a ratchet
  (§7), not a diff gate.

**Answer to Q1: yes, unambiguously.** Diff/changed-line scoping is the established answer for making
a metric blocking on a codebase that cannot reach the metric's ceiling — attested independently in
mutation testing (Google, arcmutate, Mull, Cosmic Ray), coverage (Sonar, Codecov, diff-cover,
undercover) and static analysis (golangci-lint). Where the granularity is stated, **line is the
default and file is the deliberate widening**, which is the reverse of what shipped here.

## 4. Q2 — is a committed accepted-survivor baseline a recognised pattern?

Yes, and it is well-documented — including its failure modes, which the tools themselves are candid
about.

**The pattern.** PHPStan: *"The baseline enables you to start using PHPStan on an existing codebase
_as if_ it had no existing errors"* ([baseline](https://phpstan.org/user-guide/baseline)). Psalm:
baselines *"grandfather-in errors in existing code, while ensuring that new code doesn't have those
same sorts of errors"*
([dealing with code issues](https://psalm.dev/docs/running_psalm/dealing_with_code_issues/)). ESLint
bulk suppressions (v9.24.0+): *"This feature allows for enabling new lint rules as `"error"` without
fixing all violations upfront"*
([v9.24.0 release](https://eslint.org/blog/2025/04/eslint-v9.24.0-released/)). Android lint: *"take a
snapshot of your project's current set of warnings and use it as a baseline for future inspection
runs so that only new issues are reported"*
([lint](https://developer.android.com/studio/write/lint)).

Note what these say about the relationship to §3: **a baseline is an implementation of diff scoping,
not an alternative to it.** Mirtes' own post title is *"PHPStan's baseline feature lets you hold new
code to a higher standard"*
([Medium, 2019-10-21](https://medium.com/@ondrejmirtes/phpstans-baseline-feature-lets-you-hold-new-code-to-a-higher-standard-e77d815a5dff)).
The real question is *where the "what is old" boundary is computed*: in a committed file
(PHPStan/Psalm/ESLint/Android/betterer), from VCS at gate time (golangci-lint, diff-cover, Codecov
patch), or from server-side history (Sonar).

**Keying, and what it costs.** Psalm keys on file + issue type + **code snippet**, no line numbers
(read off Psalm's own committed `psalm-baseline.xml`) — survives moves within a file, breaks on an
edit to the expression. ESLint keys on file → rule → **count**: `"src/file1.js": {"no-undef":
{"count": 1}}`. Checkstyle keys on **regex patterns** — broadest blast radius, silently covers future
violations. arcmutate is the closest thing in mutation testing: an external `.pitest.exclude` CSV of
`file, clazz, method, mutator, line start, line end`, *"each field is glob"*
([exclusions](https://docs.arcmutate.com/docs/exclusions.html)) — note it keys on **mutator name**,
which is the one axis a Stryker comment also has.

**Documented failure modes, from the tools' own mouths.**

| Failure mode | Official statement |
| --- | --- |
| Rot; never shrinks | PHPStan: *"The life goal of a baseline file is to not exist."* Adding new errors makes elimination *"an impossible task."* |
| Loses the *why* and the location | PHPStan contrasts inline ignores, which *"implicitly track the line number and therefore the location of the error"*; a baseline entry carries neither reason nor site. |
| Cannot attribute a regression | ESLint, explicitly, on what happens when a count goes up: *"There's no reliable way to determine whether the new violations were introduced recently or already existed"* ([introducing bulk suppressions](https://eslint.org/blog/2025/04/introducing-bulk-suppressions/)). |
| Stale entries accumulate | ESLint nags *"There are suppressions left that do not occur anymore. Consider re-running the command with `--prune-suppressions`"*; PHPStan defaults `reportUnmatchedIgnoredErrors` on. |
| A fixed issue silently returns | Android lint warns that issues *"are no longer reported"* and says you *"can optionally re-create the baseline to prevent an error from coming back undetected."* |
| Regeneration as a silencer | PHPStan warns against it directly; Android lint requires you to *"manually delete the file"*; Psalm's `--update-baseline` *"will remove fixed issues, but will not add new issues."* |
| Scale limit | PHPStan: *"It works best when you want to get rid of a few dozen to a few hundred reported errors."* |

**The one consistent design consensus across the whole corpus:** every mature baseline tool makes
*growing* the baseline harder than *shrinking* it — Psalm's safe command cannot add, betterer
auto-updates only on improvement, Android lint makes you delete the file by hand, PHPStan nags by
default. If a baseline is ever built here, replicate that asymmetry; it is the single most
reproducible finding in §4.

**Android lint's counter-design is the most transferable idea in this section:** baselines *"are
enabled when you run inspections in batch mode… but they are ignored for the in-editor checks"*,
because they are *"intended for codebases with a large number of existing warnings where you still
want to fix issues locally while touching the code."* **Suppress the gate, never the feedback.** That
is precisely the shape §9 recommends: a narrow failure scope over a wide reporting scope.

**Answer to Q2:** recognised, well-supported, and the *wrong tool for this repo's problem* — see §9.
Two reasons specific to here. (a) The 64 are not homogeneous legacy debt: 17 are a *structural*
class that will keep being regenerated by new code written in the same style, and a baseline
enumerating instances of a class is the anti-pattern `quality-gates.md` already names ("a rising
suppression count is the signal that the rule failed admission"). (b) A baseline is redundant with
diff scoping, which computes the same boundary from VCS with zero artefact to rot, merge-conflict,
or regenerate.

## 5. Q3 — equivalent mutants: state of the art, and StrykerJS's actual position

**The problem is undecidable, and identification is manual. This is not a hedge.** Two independent
primary statements:

- Google, in the context of designing production suppression rules: *"An equivalent mutant is a
  program that is syntactically different from the original, but semantically equivalent to it. The
  question of equivalence is unfortunately undecidable, so avoiding generating equivalent mutants is
  important"* (ICSE-SEIP 2018 §A.2.1).
- Papadakis, Shin, Yoo, Bae, ICSE 2018 §2: *"some mutants cannot be killed as they are functionally
  equivalent to the original program. These mutants are called equivalent and need to be removed from
  the calculation of the mutation score. However, their identification is done manually as it is an
  instance of an undecidable problem"*
  ([PDF](https://coinse.github.io/publications/pdfs/Papadakis2018hi.pdf)).

**A precision correction worth carrying, because the folklore citation is wrong.** Budd & Angluin
1982 is universally cited as *proving* equivalent-mutant detection undecidable. Read directly, it
does not: it takes program equivalence as already known undecidable (*"it is well known that the
equivalence problem for the set of all FORTRAN programs is undecidable"*) and proves the **link** to
test-data generation — Theorem 9: *"If a generator procedure is computable then the equivalence
problem for 𝒫 is decidable"*, and Theorem 12: *"There exists neighborhoods Φ for which the problem
of deciding whether an adequate test set exists is undecidable"*
([ETH-hosted scan](https://archiv.infsec.ethz.ch/intranet_secured/8/0/BA82.pdf)). Jia & Harman's
canonical restatement is the one everyone actually means: *"Automatically detecting all equivalent
mutants is impossible, because program equivalence is undecidable. The equivalent mutant problem has
been a barrier that prevents Mutation Testing from being more widely used"* (TSE 2011 §II —
**sourcing tier (iii), see §12**; the two quotes above it are first-hand and carry the point alone).

**No tool can prove a mutant equivalent in general**, so every "provably equivalent" row in
`design.md` is a *local* proof by a reader of the types — sound, but unautomatable, and invisible to
the gate. That is why the 17 sit in a prose table: there is nowhere else for them to live.

**Partial detection exists and does not help here.** Trivial Compiler Equivalence (Papadakis, Jia,
Harman, Le Traon, ICSE 2015) compiles mutant and original and compares object code; it detects
roughly **30%** of equivalent mutants against the benchmark ground truth and discards *"more than 7%
of all the mutants as being equivalent and 21% as duplicated"* on large real programs
([UCL Discovery PDF](https://discovery.ucl.ac.uk/1499169/1/Jia_Trivial_Compiler_mutation-testing-papadakis-icse15.pdf)).
TCE needs an optimising compiler; TypeScript's emit is type erasure, not optimisation, so TCE is not
available on this stack. Carry the second number too: **a fifth of mutants are *duplicates* of one
another** — the same phenomenon as this repo's "equivalent and its killable twin come from one node",
seen from the other side, and a reason to expect a residue no amount of test-writing removes.

### 5.1 The residue is not a defect of this repo — it is the expected shape of a strong suite

This is the finding that most changes how the 64 should be read, and it was not on the table.

- **The equivalent fraction among *survivors* rises as the suite gets stronger.** Schuler & Zeller
  (ICST 2010), hand-classifying 140 mutants across seven Java programs: *"about 45% of all undetected
  mutants turned out to be equivalent"*, and — boxed as a finding — *"The percentage of equivalent
  mutants increases as the test suite improves."* Their reasoning is arithmetic: *"A perfect test
  suite would detect **all** non-equivalent mutants; hence, 100% of undetected mutants would be
  equivalent"*
  ([PDF](https://www.st.cs.uni-saarland.de/publications/files/schuler-icst-2010.pdf)).
  For a repo at 100% line coverage that has just burned 464 survivors down to 19, **a survivor list
  that is mostly unkillable is the predicted outcome, not a failure of the burn-down.** On the
  pre-rebase branch it was 17 of 19 — 89%. That number is high but it is on the curve, not off it.
- **As a fraction of *all* mutants, roughly 7–40% equivalent is the historical range.** Jia & Harman
  TSE 2011: *"Empirical results indicate that there are 10% to 40% of mutants which are equivalent"*
  [tier (iii)]; TCE measured 7.4% mechanically detectable as equivalent [tier (ii)]; Google's ICSE
  2021 Defects4J sample came out at 10.6% [tier (ii)]. Wide, but every point in the range is far
  above zero.
- **Most mutants are redundant, not informative.** Minimal/dominator-set studies converge hard:
  Ammann, Delamaro & Offutt (ICST 2014) — *"on average, only 1.2% of mutants are in a minimal set"*
  [tier (ii)]; Kurtz et al. (FSE 2016) — ~0.85% dominators, a **116:1** redundancy ratio [tier (ii)];
  Papadakis et al. (ISSTA 2016) — *"fewer than 5% of all mutants are subsuming… The remaining 95% of
  mutants are subsumed by some other mutants"* [tier (iii)]. The 2019 survey's summary: *"only few of
  the mutants produced (approximately 5%) is practically useful. The rest is noise to the process
  with severe consequences"* [tier (iii)].
- **Classifying one equivalent mutant costs real time.** Grün, Schuler & Zeller (2009): *"it took us
  15 minutes to assess the equivalence of a single mutation."* Schuler & Zeller (2010): *"On average,
  it took us 14 minutes 28 seconds to classify one single mutation for equivalence"*, max 130
  minutes. Google, on a Defects4J sample, got it down to *"an average of 4.6 minutes per mutant"* —
  and found the asymmetry that matters here: *"The time to write a test to kill an unproductive
  mutant is on average higher than the time to determine mutant equivalence"* (5.2 min to kill an
  unproductive killable mutant vs 3.5 min to determine equivalence).

**Read against `quality-gates.md`, this is decisive.** A blocking gate whose only exits are "kill it"
or "waive it" imposes a 4–15 minute human-or-agent judgement per survivor, on a population where the
literature expects a large unkillable fraction *precisely because the suite is good*. That is the
appeasement pressure the admission contract exists to bound, and it does not go away by burning the
list down — the burn-down makes the remaining fraction *worse*.

### 5.2 What the state of the art does about equivalents in production: class-level AST rules

Google's `expert` function is exactly this, and the papers are unusually concrete:

- *"In the for-statement condition, the less than operator is not mutated to a not-equal operator.
  This usually results in the equivalent mutant and is suppressed."* (Fig. 10)
- For C++ `nullptr`: *"The mutants marked in bold are equivalent because of the falsy value of
  `nullptr`… These mutation subtypes are suppressed."* (Fig. 11)
- Memoisation: *"Such an if statement is a cache-lookup statement and is considered arid by the
  `expert` function… the change is not detectable by any semantic tests."* (Fig. 9)
- And the governing sentence: *"This process is manual: if we decide a certain mutation is not useful
  and that the whole class of mutants should not be created, the rule is added to the `expert`
  function. This is the critical part of the system because, without it, users would become
  frustrated with non-actionable feedback and opt out of the system altogether."*

The scale is worth stating, because it sets expectations for `ignore-unions`: TSE 2021 §5 records
*"currently 26 rules that are applied to all languages, and 114 language-specific rules"*, and the
suppression happens **before** mutants are generated — *"Suppression of arid nodes reduced the number
of mutants by 11% for Java and by 30% for C++."*

That is **exactly** option 4, and exactly what `design.md` already proposes as `ignore-unions`. The
attested industrial answer to a recurring equivalent-mutant family is a **rule at the config site
that inspects the AST**, not N suppressions at N sites, and not a list of instances. Note one
mechanical difference: Stryker's ignorer marks a mutant `Ignored` rather than preventing generation,
so the compute is still spent — but `Ignored` is outside the score denominator (§2.5), so the effect
on the verdict is identical.

**And the field's own answer to "should we chase zero survivors" is no.** Petrović, Ivanković,
Fraser & Just, *Does mutation testing improve testing practices?* (ICSE 2021), state it as flatly as
anything in this document: *"achieving mutation adequacy is neither practical nor desirable"*, and
*"Considering the fact that most mutants are irrelevant and that mutant equivalence is undecidable,
aiming at mutation adequacy is hopeless… a rational goal for a developer is to just make a test
suite better, but not mutation adequate"*
([PDF](https://homes.cs.washington.edu/~rjust/publ/mutation_testing_practices_icse_2021.pdf)).
The same paper adds the nuance that stops this becoming an excuse: *"there exist killable mutants for
which developers justifiably should not and, in practice, will not write tests. Conversely,
equivalent mutants sometimes reveal issues in the source code, and hence are useful."* Both halves
match this repo's experience exactly — the burn-down found no live defect but a long list of unpinned
invariants, and the `codec !== ''` equivalent was *deleted as dead code* rather than waived.

**Does any tool offer per-mutant suppression?**

- **StrykerJS: no.** Suppression is by line+mutator (comment) or AST predicate (plugin). §2.2.
- **pitest (OSS): no** — `excludedMethods` is method-glob, `avoidCallsTo` is class/package-level
  ([quickstart/maven](https://pitest.org/quickstart/maven/)). A `DoNotMutate` marker exists in the
  source tree but is **not documented** on pitest.org. pitest 1.25.0 added *"introduce equivalent
  status"* (`#1471`) — the PR body is empty, so the mechanics are unconfirmed; the surrounding
  changelog (e.g. *"filter mutants in enum switch default block"*) shows the direction is **built-in
  interceptor filters**, i.e. class rules again.
- **arcmutate: closest.** The `.pitest.exclude` CSV keys on `mutator` **and** a line range **and**
  class/method globs — narrower than a Stryker comment, still not node-identity.
- **Cosmic Ray + spor: the most interesting near-miss.** `cosmic-ray-spor-filter` reads *"a spor
  anchored metadata repository"*; spor keeps metadata *"in a separate file from your source code, and
  spor uses 'anchoring' techniques to keep the metadata in sync with the source code"* as it changes,
  via offset + width + a **context window** ([spor](https://github.com/abingham/spor)). This is the
  only mechanism found anywhere that is explicitly designed to make a suppression **survive
  refactoring**. Still span-based, not mutator-keyed.
- **mutmut, Mull, Stryker.NET: no** per-mutant suppression found.

**Answer to Q3.** Nobody offers suppression keyed on `(mutator, replacement, AST node)`. The field's
answer to a *family* of equivalents is a class-level AST rule; its answer to a *one-off* equivalent
is a coarse site suppression, accepted as coarse. StrykerJS is squarely on that line, and the repo
has already discovered the coarseness the hard way. Option 3 (refactor onto separate lines) is
**ruled out on evidence already in the repo**: `ConditionalExpression` emits `true` and `false` from
one node and `EqualityOperator` emits both substitutions from one operator token, so the equivalent
and its twin are co-located whatever the formatting — no line split can separate them. Attempting it
anyway would be contorting production code to satisfy a tool, which `quality-gates.md` names as the
appeasement the admission contract exists to prevent.

## 6. Q4 — is a percentage `thresholds.break` sound on a scoped run?

No, and the evidence is unusually direct.

- **Google, who could compute it, chose not to.** *"we were also unable to find a good way to surface
  it to the engineers in an actionable way"* and *"Living mutants… alone do not make a good measure
  of efficacy"* (§3.1). Their own §5.3 warns the raw survival ratio *"is not the mutation score…
  because of the probabilistic nature of mutagenesis where only a subset of mutants is generated."*
  That caveat applies verbatim to any scoped Stryker run: the denominator is whatever the scope
  produced.
- **The denominator moves with the diff.** Stryker's score is `detected / valid`, excluding `Ignored`
  (§2.5). On the measured PRs that denominator ranged from 372 mutants (2 files) to thousands. A
  fixed percentage means "one survivor is fatal on a small diff and free on a large one" — the gate's
  strictness would be inversely proportional to the size of the change, which is backwards.
- **The academic evidence is against the *number*, and for the *findings*.** Papadakis, Shin, Yoo &
  Bae (ICSE 2018) tested the mutation-score-vs-real-fault-detection relationship on CoreBench and
  Defects4J while controlling for suite size, and found *"that all correlations between mutation
  scores and real fault detection are weak when controlling for test suite size."* Their diagnosis is
  the one that matters here: *"mutants are indeed capable of representing the behaviour of real
  faults. However, these mutants are very few (less than 1% of the involved mutants)… mutation scores
  are subject to 'noise effects' caused by the large numbers of mutants that are, in some sense,
  'irrelevant' to the studied faults."* And their positive finding is equally important — *"achieving
  higher mutation scores improves significantly the fault detection"* and *"mutants provide good
  guidance for improving the fault detection of test suites, but their correlation with fault
  detection are weak."* Read together: **mutation testing earns its place; the mutation score does
  not.** That is D1 restated by an independent empirical study, and it is the strongest external
  support the current design has.
- **`design.md` D1 already rejects it** on Goodhart grounds, and the repo's own history is the proof:
  the same document records a score that read **99.89%** while 96 mutants were silenced by a
  suppression that never ended. A percentage is precisely the shape that made that invisible; a named
  per-mutant finding is the shape that made it visible again.
- **Sonar's own advice against piling conditions onto a gate applies:** adding more *"may lead to
  bottlenecks in the pace of development with minimal benefit"* and risks *"an ignored quality
  gate."*

- **A practitioner warning from the one industrial report that considered gating.** Zenseact's
  IEEE-published experience report on adopting mutation testing in automotive discusses a threshold
  gate and warns that engineers *"could be tempted to write tests to increase the mutation score
  without actually testing the code"* — the appeasement failure named from the field rather than
  from doctrine ([IEEE](https://ieeexplore.ieee.org/document/10371613)) **[abstract/landing page
  only; the full text was not reachable]**.

Keep `thresholds: { break: 100 }` if Stryker's exit code remains the verdict, since at 100 it is
literally "zero survivors" and not a percentage in any meaningful sense. Do not introduce a sub-100
number. **Answer to Q4: unsound; do not adopt option 5.**

**But note what §5.2 does to `break: 100` even read as "zero survivors".** Google: *"aiming at
mutation adequacy is hopeless."* Zero-survivors is mutation adequacy, restricted to a scope. That is
tolerable only because the scope is small — which is another way of saying **the narrower the failure
scope, the more defensible the zero-tolerance threshold on it.** File scope plus `break: 100` is
adequacy over every line of every file you touched; changed-line scope plus `break: 100` is adequacy
over the lines you wrote, which is what "you own the new code" means everywhere else in §3.3.

## 7. Q5 — CI cost, timeouts, and ratchets that do not become rubber stamps

**Cost.** Measured (§1): 13m16s for the Stryker step on a 36-file diff against a 20-minute job
timeout — 66% of budget, 6m44s of headroom. Today a timeout is invisible (`continue-on-error`).
Once blocking, a timeout is a **red required check on a correct branch**, which is the worst failure
a gate can have: it is unattributable, it re-runs non-deterministically, and an agent loop learns
that the mutation check is the flaky one. Three levers, in the order `design.md` D4 already names:
`--concurrency` first, then narrowing scope; add a third, raising `timeout-minutes`, which is free
and should be done regardless. A fourth, larger runners, costs money.

The scope lever is the interesting one: under changed-**line** scope the mutant count falls roughly
with changed lines rather than changed files, which is exactly the cost reduction Google built their
system around (*"A diff-based approach greatly reduces the number of lines in which mutants are
created, and the suppression of arid lines cuts the number of potential mutants further"*) — and
which they quantify as 820 → 77 → 7 median mutants per changelist (§3.1). Two orders of magnitude,
from the same two levers this repo has half-applied.

**Google's own compute framing is worth borrowing:** TSE 2021 describes mutation analysis as *"about
a 2% overhead compared to the tests being executed regularly"* and notes they run it *"during
off-peak hours"*. Nothing here is off-peak — the job sits on the merge path — which raises the value
of the scope lever further.

**Flakiness is a real category here.** `report-model.ts` treats `Timeout` as detected and
`NoCoverage` as surviving. A loaded runner turning a `Killed` into a `Timeout` is safe; a mutant that
is killed by a timing-sensitive test is not. Nothing in the repo currently measures mutation-verdict
stability across reruns, and once the check blocks, that number matters.

**Ratchets.** The canonical named source is Patrick Kua's *An Appropriate Use of Metrics* on
martinfowler.com: *"Ratcheting involves adding a code analysis tool to a continuous integration build
that fails when a certain metric exceeds a certain value"*, and *"On each small improvement, the team
revises the current value downwards."* The repo already has one: `mutation-scope.test.ts`'s
suppression `CEILING = 58`, documented as *"a CEILING TO DRIVE DOWN, never a budget to spend"*. That
is the right shape and should be kept.

The rubber-stamp failure mode is documented rather than hypothetical. betterer — the purest ratchet
tool, *"If it gets better, the .betterer.results file will be updated… If it gets worse, your test
will fail"* — has an open bug, [#1181](https://github.com/phenomnomnominal/betterer/issues/1181),
that once a goal is met the ratchet stops holding [reporter's account; no maintainer confirmation on
the page]. ESLint concedes it cannot attribute a count increase. PHPStan names operator regeneration
as the thing that makes cleanup *"an impossible task."* The common thread: **a ratchet whose value is
mechanically regenerable by the party it constrains is a rubber stamp.** In an agent loop, the
constrained party *is* the party that edits the file. That is the decisive argument against any
committed, agent-writable survivor list, and it is stronger here than in any human team.

## 8. Where the prior research needs amending

`docs/research/automated-quality-function.md` ranked StrykerJS #1 and was right about the mechanism.
Shipping it revealed four things that doc could not have known and that should be carried forward:

1. **Its own §5.1 recipe was not implemented.** The doc says "mutate only changed, covered lines";
   the shipped gate mutates changed *files*. §3 establishes that the line form is the attested one
   and that the deviation's stated justification is unavailable.
2. **"Advisory → then gating" understated the cost of the second step.** Its verdict phrased the
   ramp as "(per-diff or nightly-with-cache, advisory → then gating on changed-code mutation score)"
   — two errors: `--incremental` is unusable in the PR job (D4a, §2.4) and gating on a *score* is
   unsound (§6). The correct phrasing is "advisory → then gating per-mutant on changed lines."
3. **The doc's pitfall "mutate only changed covered lines, suppress arid lines, cap mutants per line,
   or mutation testing drowns in noise" was right and is only two-thirds implemented.** The arid
   suppression (D6/D7) and the one-per-line surfacing (`summarize.ts`) shipped; the line scoping did
   not.
4. **A new pitfall the literature does not contain, discovered here:** *the suppression mechanism
   itself can silently lie.* A `// Stryker disable` whose `restore` never fires silences to
   end-of-file and produces a **higher** score. Any adoption of a comment-based suppression mechanism
   needs a boundary test that re-derives what was actually silenced from the instrumenter, which is
   what `mutation-scope.test.ts` now does. This belongs in the pitfall list of any future doc.

Also worth recording against `docs/research/result-lint-and-tier-enforcement.md`: its
measure-violations-before-adopting method is what §9 asks for again here (measure the effective
false-positive rate of the *blocking* configuration on real PRs before making it required), and its
conclusion that a rule must be `error` or off is the same argument as `continue-on-error` being a
disguised warning.

## 9. Verdict and recommendation

### The leaning is right, and under-specified. Adopt option 1, with option 4 as its partner.

**Recommendation, in one sentence:** make the *failure* scope the changed lines (option 1), keep the
*reporting* scope the changed files, and retire the two structural equivalent-mutant families with a
narrowly-scoped ignorer plugin (option 4) in its own change — then flip.

This is the only combination that is attested end-to-end. Line-scoped failure is what Google does
(*"Only lines affected by the diff under review that are covered and are not arid are mutated"*),
what arcmutate, Mull and Cosmic Ray default to, and what Sonar/Codecov/golangci-lint/diff-cover do
in the adjacent coverage problem. Class-level AST rules are what Google does about recurring
equivalents. Wide reporting under a narrow gate is Android lint's *"suppress the gate, never the
feedback."*

**How to implement the failure scope — a real choice with a real trade.**

- **(A) Post-filter a file-scoped run.** Keep `--mutate <changed files>` exactly as today; keep
  `continue-on-error: true` on the *Stryker* step so its exit code stops being the verdict; add a new
  **failing** step that reads `reports/mutation/mutation.json` and fails only if a surviving mutant's
  span intersects a changed hunk (computed with `git diff -U0` against the same merge-base).
  Advantages: the step summary keeps the full file-scoped inventory, which is strictly more
  information and preserves the "catches a weakened assertion elsewhere in the same file" property as
  *reporting*; no change to Stryker invocation. Cost: no wall-clock saving (§1's 13m16s stands).
- **(B) Range-scope the run.** Pass `--mutate 'path:start-end,path:start-end,…'` built from the diff
  hunks (§2.1 — valid, and the maintainer's own recommendation), and let Stryker's `break: 100` be
  the verdict, so `continue-on-error` is deleted outright. Advantages: much cheaper, simpler, no new
  verdict code. Cost: the report shrinks to the changed lines, and **containment semantics drop
  whole-block mutants** (§2.1) — the family that is 72% of Google's mutants.

**Take (A) first, keep (B) as the named tuning lever** the moment wall-clock or the 20-minute
timeout becomes the binding constraint. (A) also lets the intersection test use **overlap** rather
than Stryker's **containment**, so a `BlockStatement` mutant covering a function you edited one line
of still counts — recovering exactly what (B) loses. That is the single strongest argument for (A),
and it is not available in (B) at all.

**The trade is genuinely close, so here is the decision rule rather than a preference.** (A) costs
~14 minutes on the merge path and buys complete diff-time reporting plus overlap semantics; (B) costs
minutes-to-seconds and buys neither. Take (A) if the 7× merge-latency increase is acceptable to the
owner; take (B) the first time a PR's Stryker step exceeds ~15 minutes, and accept two consolations:
the changed-line findings — the ones the gate actually blocks on — are unaffected, and the
**weekly full run already exists** as the wide channel for everything (B) stops seeing at diff time.
What (B) genuinely loses is *timeliness* of the file-wide signal, not the signal itself. Do not treat
this as a permanent fork: instrument the Stryker-step duration in the job summary so the switch is
triggered by a number rather than by irritation.

**Reject options 2, 3, 5, 6.**

- **2 (baseline file):** recognised but wrong here — §4. It duplicates what diff scoping computes for
  free, it rots (PHPStan: *"The life goal of a baseline file is to not exist"*), it cannot attribute
  a regression once a count moves (ESLint's own admission), and in an agent loop the constrained
  party can regenerate it (§7). If it were ever built, key on `(file, location, mutatorName,
  replacement)` — never on `id` (§2.4/§2.6) — and make growing it harder than shrinking it.
- **3 (refactor onto separate lines):** ruled out by evidence already in `design.md` — the equivalent
  and its killable twin come from the *same node* for both mutator families. §5.
- **5 (percentage break):** unsound on a varying denominator; rejected by D1, by Google, and by the
  repo's own 99.89% incident. §6.
- **6 (`--incremental` baseline):** rejected by D4a for the right reason, and additionally blocked
  upstream — [#6004](https://github.com/stryker-mutator/stryker-js/issues/6004), open against the
  pinned 9.6.1, makes the incremental file uncommittable with the vitest runner. §2.4.

### What to do about the ~17 unwaivable equivalents

**First, stop treating them as debt.** §5.1 says the equivalent fraction among survivors *rises* as
the suite improves (Schuler & Zeller: *"The percentage of equivalent mutants increases as the test
suite improves"*), that under 5% of mutants carry unique information at all, and that Google calls
mutation adequacy *"hopeless"*. Seventeen unkillable survivors after a 464→19 burn-down is the
literature's predicted outcome, not a residue of incomplete work. Task 2.1's exit criterion — "main
becomes mutant-clean" — is therefore **unreachable in principle**, not just unreached, and any plan
whose next step is "finish the burn-down" is planning against a state that does not exist.

**Second, under the recommendation nothing has to be done to them before the flip.** That is the
point of line scoping: a mutant on a line no PR touched cannot fail that PR. The 17 stop being a
blocker the moment the failure scope stops including untouched lines — and when a PR *does* edit one
of those lines, being asked to re-audit the equivalence claim is correct behaviour, not friction.
This is the same property Sonar sells: *"You own the quality and security of the new code you are
working on today."*

Three follow-ups, in priority order, none of them blocking:

1. **Write the `ignore-unions` ignorer plugin** that `design.md` already recommends, in its own
   change with its own grilling, and let it retire families 1 (exhaustive `switch` arms that yield
   nothing) and 2 (type-narrowing operands on discriminated unions) at the config site. This is the
   attested shape (Google's `expert` function; Stryker's own maintainer pointing every "control which
   contexts get mutated" request at #3229) and the doctrine-preferred one (*"A rejected rule is
   disabled once, in configuration, with its reason"*). Expected effect per `design.md`: ~17
   recorded survivors cleared and the inline-waiver count back to roughly 25. Its false-negative cost
   — it would also hide a genuinely wrong `case` grouping — must be argued and bounded by a test the
   way `ignore-logging.mjs` is.
2. **Keep the recorded-survivor table in `design.md` as the audit record**, and add a boundary test
   that fails if the table and the weekly full run disagree. Right now the table is prose that
   nothing checks; the same class of drift that produced a false 99.89% can produce a false table.
3. **Take the free wins that already exist.** `design.md` records that `'location' in state` /
   `'remediation' in state` removed two of these rows outright, because `in` is not a
   `ConditionalExpression` operator — the equivalent mutant does not exist to begin with. That is the
   promotion ladder's top rung ("type it away") and it is available wherever it does not cost domain
   readability. It was correctly *not* applied to `decide.ts`'s phase guard.

The **2 MusicBrainz survivors are a different animal and must not be swept up with the 17.** They are
a real unspecified-behaviour finding (an album title that normalises to empty comparing equal to an
absent title; `÷`, `+`, `?` are real releases). Under line scope they also stop blocking, but they
are a domain bug to fix — the `undefined`-not-`''` identity change `design.md` names — not a mutant
to suppress. Fixing them is the honest close; waiving them would be exactly the fiction
`testing.md` forbids.

### Can `continue-on-error` be removed, and what else must change with it

**Under (A): no — it moves, and this must be stated plainly rather than presented as a removal.**
The flag stays on the Stryker step *because the verdict moves off Stryker's exit code*; the job then
gains a new step that carries the verdict and does **not** have the flag. That step must fail on
three things, not one:

1. a surviving mutant whose span intersects a changed hunk;
2. a **missing or unreadable** report — `report-model.ts` already models all three "no report" cases
   and `file-drift.ts` already refuses to report zero drift on an unreadable one; the PR verdict step
   needs the same refusal, or a Stryker crash becomes a green gate;
3. a scope that resolved to files but produced **zero analysed mutants**, which `summarize.ts`
   already detects and describes (*"Every mutant here was ignored, so nothing in this scope was
   actually audited"*) but does not act on.

Under (B), `continue-on-error` is deleted outright and Stryker's `break: 100` is the verdict — which
is cleaner, and is a genuine argument for (B) if the extra verdict code feels like too much machinery.

**What else must change with the flip:**

- **`timeout-minutes: 20` becomes load-bearing.** 13m16s observed, 66% of budget, and the cost is not
  bounded by the file count. Raise it (30 is the same order as the existing `release` job) *and*
  record the observed numbers where the comment currently says *"NOT yet observed in CI"*. A blocking
  job that times out is worse than no job.
- **Merge latency goes from ~2 min to ~14** (§1). Nothing forbids it, but it should be a decision,
  not a discovery. Under (B) it largely goes away.
- **Measure the effective false-positive rate on this repo before requiring the check.**
  `quality-gates.md`'s bar is *"Under ten percent effective false positives, measured on *this*
  repository, not on the check's reputation elsewhere."* Google, after years of tuning across seven
  languages and 140 arid rules, reports mutant productivity of **82% aggregate, 80→89% over time,
  against a stated ~90% target** (§3.1). So the industry-best number is *at* this repo's bar, not
  comfortably inside it — **and Google's release valve is a human clicking "Not useful", which this
  factory does not have.** The flip is admissible only if the *scoped, post-D6/D7,
  post-`ignore-unions`* configuration measures under 10% on real PRs here. Run the blocking logic in
  shadow (compute the verdict, print it, don't fail) across a handful of real PRs and count. This is
  the same measure-before-adopt method `result-lint-and-tier-enforcement.md` used for a lint rule.
- **Cap the *verdict* per line, not just the summary.** `summarize.ts` already applies Google's
  one-mutant-per-line surfacing rule, and says so (*"killing the shown one usually kills its
  siblings"*) — which TSE 2021 confirms empirically (*"In more than 90% of the cases, either all
  mutants in a line are killed, or all mutants in a line survive"*). But the *verdict* still counts
  every survivor, so one weak line can present as a dozen blocking findings. Google caps the surfaced
  set to a median of **7 per changelist**; this gate has no cap at all. Deduplicating the failing set
  per line costs nothing and makes the finding count honest.
- **A cheap, justified escape hatch must remain.** 100% mutant-clean is unreachable (§5), so the gate
  needs a legitimate "this one is equivalent, here is why" exit that does not require appeasing it
  with a fiction test. Today that is `// Stryker disable next-line`, which is too coarse for the very
  family that needs it. The ignorer plugin is the durable answer; until it lands, an explicitly
  recorded survivor with a written reason is better than a waiver that silences a twin — which is the
  position `design.md` already took, and it was right.
- **`test/boundaries/mutation-scope.test.ts` pins the job's command shape** (`expect(pipeline).toMatch(
  /run: pnpm exec stryker run --mutate/)`) and the scope alternation. Both need updating with the
  job, and the new verdict step deserves its own scenario — otherwise deleting the gate leaves the
  boundary tier green.
- **`report.ts`'s contract inverts.** Its header says *"Never decides pass/fail — Stryker's exit code
  does that."* Under (A) that stops being true and the comment becomes a lie of exactly the kind this
  repo hunts.
- **`design.md` D2's "blocking is a deviation from Google" remains unattested and should stay marked
  so.** §3.1 confirms Google never blocked. The deviation may still be right for an unattended loop —
  the Meta 0%-vs-70% batch/diff finding says an advisory channel with no consumer is dead — but it is
  reasoning by analogy, not evidence, and the compensations D2 promised (narrower scope than Google's,
  a seeded arid list) are only half delivered while scope is *wider* than Google's.

### Pitfall checklist (drawn from the sources)

- **Do not let a suppression mechanism grade itself.** A block-form `disable` with no firing
  `restore` silences to end of file and *raises* the score. Re-derive what was actually silenced from
  the instrumenter, in a test. (This repo, discovered the hard way; not in any literature.)
- **A mutant is a sub-expression, not a line.** Triage off `location.start/end` columns, never off the
  printed source line. (`design.md`; and the report schema carries columns — §2.6.)
- **Range scoping drops whole-block mutants.** `locationIncluded` is containment. SBR is 72% of
  Google's mutants and the second-least likely to survive — losing it silently is a big hole. Prefer
  overlap in a post-filter.
- **Parse `git diff -U0` hunk headers carefully.** `@@ -a,b +c,d @@` with `d` absent means one line;
  **`d == 0` means a pure deletion** and adds no lines to mutate — turning it into the range `c-c`
  would gate on a line the branch never touched. (Verified against a real diff in this repo:
  `-U0` emits both `+85` and `+44,25` forms.)
- **Never key a baseline or a report join on Stryker's mutant `id`** — it is a per-run ordinal
  (`MutantCollector.nextMutantId++`). Key on `(file, location, mutatorName, replacement)`.
- **A ratchet the constrained party can regenerate is a rubber stamp.** betterer #1181, ESLint's
  count-attribution admission, PHPStan's warning against regeneration. In an agent loop this is not a
  risk, it is the default.
- **Baselines rot and lose the *why*.** If one is ever built: reason required per entry, staleness
  detection on by default, and growth harder than shrinkage.
- **An arid/ignore rule that is too broad stops auditing real code with nobody noticing.** D6's
  narrow scoping (arguments only, statically-named receiver *and* level) and its own test are the
  model; `ignore-unions` must be held to the same bar, and its false-negative named.
- **A blocking check that can time out or flake is worse than no check.** Raise the timeout, measure
  verdict stability across reruns, and make a missing/unreadable report a failure rather than a pass.
- **Do not gate on a score.** Denominator varies with scope; Google could compute it and chose not
  to; this repo already produced a false 99.89%. Zenseact's field warning is the concrete failure:
  engineers *"tempted to write tests to increase the mutation score without actually testing the
  code."*
- **Do not set "zero survivors anywhere" as a milestone.** The equivalent fraction among survivors
  *rises* as the suite improves (Schuler & Zeller); <5% of mutants carry unique information
  (subsumption studies); Google calls adequacy *"hopeless"*. A plan that waits for a clean main waits
  forever.
- **Cap findings per line and per PR.** One weak line spawns a dozen mutants; Google surfaces ≤1 per
  line and a median of 7 per changelist. An uncapped blocking gate turns one fix into a wall.
- **Appeasement is the failure mode, not noise.** `quality-gates.md` and `testing.md` both say it:
  a finding an agent cannot honestly fix gets a fiction test. Every mutation finding must have a
  legitimate non-test exit (kill, delete, type away, or a justified precise waiver).

### Attested vs unattested in the current design

**Attested (named prior art, verified this pass):**
- Diff-time deployment of the finding — Google (mutation), Meta (static analysis), Sonar, Codecov.
- Per-mutant findings rather than a score — Google explicitly rejects the score (§3.1, §6).
- At most one surfaced mutant per line (`summarize.ts`) — Google's exact rule, quoted §3.1.
- Arid-node suppression as a **configured rule with its reason** (D6, `ignore-logging.mjs`) —
  Google's `expert` function, and the mechanism Stryker's maintainer points every such request at.
- A class-level rejection of a mutant family that is false for a structural reason (D7 `ignoreStatic`)
  — same category as Google's `nullptr`/`for`-condition suppressions.
- Adapters in scope (D3) — no contrary evidence found; consistent with mutation testing's general
  claim to find assertion gaps wherever they are.
- The suppression **ceiling** in `mutation-scope.test.ts` — a textbook ratchet (Kua).
- A weekly full run filing tracker issues rather than blocking — the "durable channel" half of the
  Meta batch-vs-diff finding.

**Unattested / this repo running ahead of the evidence (flag as risk):**
- **Blocking rather than advisory** (D2). Google never blocked — *"These findings do not need to be
  resolved by the author before submission, unless a human reviewer marks them as mandatory"* (TSE
  2021 §2.4); arcmutate defaults to a *warning*-level check run; Meta's mutation work surfaced
  mutants as review comments [secondary, and the source link did not survive re-check — see §12].
  **No peer-reviewed deployment of a blocking mutation gate was found in this sweep.** The argument
  for blocking here (no human to shrug, and an advisory
  channel with no consumer is the attested-dead Meta batch shape) is sound reasoning by analogy, but
  it is analogy, not evidence — and this repo has now *observed* the dead-advisory shape directly:
  v3.18.0's 45 survivors were reported into a step summary that nothing consumed.
- **A gate with no per-changelist cap on findings.** Google caps at ~7 median; this one is uncapped.
  Unattested at any volume.
- **File scope** (the shipped deviation). No source found anywhere that recommends file granularity
  as a *default* for a mutation gate; golangci-lint and arcmutate both offer it explicitly as the
  *widening*.
- **A 100% break threshold on a codebase with known-unkillable mutants.** No source found that gates
  a mutation run at zero survivors; Google calls mutation adequacy *"neither practical nor
  desirable"*. Defensible only in proportion to how narrow the scope is (§6).
- **Task 2.1's "main becomes mutant-clean" exit criterion.** Contradicted by Schuler & Zeller,
  Papadakis (subsumption), and Google (adequacy) — the target state is not reachable, so the task as
  written can never close. This is arguably the single most consequential correction in this doc.
- **`design.md` D4a's claim that `thresholds.break` applies to the merged incremental whole** — true
  as measured on this repo, **not** documented upstream (§2.4). Keep it labelled as measured.
- **An agent loop as the consumer of mutation findings.** Google's 82–89% productivity was tolerable
  because a human clicks "Not useful"; there is no evidence about what an agent does with the other
  11–18% under a *blocking* gate. This is the gap that most needs measuring here, and §9 says how.

## 10. Documentation drift found (report, not fixed — this doc changes nothing else)

1. **`.github/workflows/pipeline.yml`, the `mutation` job comment** argues the `continue-on-error`
   decision from *"464 survivors to 6 (99.89%)"*, *"the 6 sit in…"*, and *"Four are provably
   equivalent narrowing operands"*. `design.md` **explicitly retracts** that number: run 6's 99.89%
   was false, corrected to 19 at 99.67%, and the tip of `main` is **64 at 98.96%**. The workflow's
   blocking rationale is argued from a figure its own design document calls a counterexample.
2. **Same file: `timeout-minutes: 20 # projected low-minutes on a 4-core runner; NOT yet observed in
   CI`.** Observed three times since (§1), the largest being 13m58s.
3. **`design.md` §Open Questions / task 3.3** records 2m31s on a 2-file diff and says *"Re-measure on
   the first PR that actually changes production code."* Two such PRs have since run (9m37s, 13m58s);
   neither is recorded, and the 2m31s figure now reads as representative when it is the smallest of
   three.
4. **`openspec/changes/mutation-gate/tasks.md` task 4.1** says the flip needs *"split the four
   narrowing-operand lines so their waivers become precise"*. `design.md` supersedes this twice over:
   there are **seventeen**, and splitting **cannot work** for this mutator family. The task's exit
   criterion is unreachable as written.
5. **The `mutation-scope.test.ts` ceiling (58)** and the burn-down's *"the repo's waiver count is now
   58"* coexist in `design.md` with an earlier paragraph claiming *"it was the one waiver in the
   repo"*, parenthetically corrected. Readable, but the parenthetical is doing a lot of work.

## 11. Cross-references

- `docs/research/automated-quality-function.md` — produced this chain; §5.1 is the Google recipe this
  doc verifies from source, and §8 above records where it needs amending.
- `docs/research/result-lint-and-tier-enforcement.md` — the in-house exemplar of measuring violations
  against this repo before adopting a rule; §9's "measure the effective FP rate in shadow before
  requiring the check" is the same method applied to a gate rather than a lint rule.
- `docs/development/quality-gates.md` — the admission contract, the waiver doctrine, the promotion
  ladder and the latency budget every recommendation above is weighed against.
- `docs/development/testing.md` — the coverage ladder and the anti-fiction doctrine that bounds what
  "kill the mutant" is allowed to mean.
- `openspec/changes/mutation-gate/{design,tasks}.md` — D1, D2, D4a, D5, D6, D7, the burn-down, the
  17-row survivor table, and task 4.1, which this doc's verdict would rewrite.

## 12. Sources

**StrykerJS (primary: docs, source, tracker — all accessed 2026-08-07)**
- Configuration (`mutate`, mutation range, `thresholds`, `ignorers`, `ignoreStatic`, `incremental`): https://stryker-mutator.io/docs/stryker-js/configuration/
- Disable mutants + ignore-plugin API: https://stryker-mutator.io/docs/stryker-js/disable-mutants/
- Incremental mode: https://stryker-mutator.io/docs/stryker-js/incremental/
- Mutant states & metrics (score denominator, status set): https://stryker-mutator.io/docs/mutation-testing-elements/mutant-states-and-metrics/
- Report schema (fields incl. `location.start/end.column`): https://github.com/stryker-mutator/mutation-testing-elements/blob/master/packages/report-schema/src/mutation-testing-report-schema.json
- `DirectiveBookkeeper` (line+mutator keying, verified): https://github.com/stryker-mutator/stryker-js/blob/master/packages/instrumenter/src/transformers/directive-bookkeeper.ts
- `babel-transformer.ts` — `shouldMutate` gates on `locationIncluded(range, node.loc)` (range containment, verified): https://github.com/stryker-mutator/stryker-js/blob/master/packages/instrumenter/src/transformers/babel-transformer.ts
- `util/syntax-helpers.ts` — `locationIncluded` / `locationOverlaps` definitions (verified): https://github.com/stryker-mutator/stryker-js/blob/master/packages/instrumenter/src/util/syntax-helpers.ts
- `MutantCollector` (`nextMutantId` is a per-run ordinal): https://github.com/stryker-mutator/stryker-js/blob/master/packages/instrumenter/src/transformers/mutant-collector.ts
- Mutation-range validation (`options-validator.ts`): https://github.com/stryker-mutator/stryker-js/blob/master/packages/core/src/config/options-validator.ts
- PR #2751 (mutation range, v4.6.0): https://github.com/stryker-mutator/stryker-js/pull/2751
- Issue #2843 (mutate only changed lines; maintainer recommends `--mutate foo.js:25-30` + git diff): https://github.com/stryker-mutator/stryker-js/issues/2843
- Issue #551 (mutate only modified files; "I wouldn't want to use git as a source of files"): https://github.com/stryker-mutator/stryker-js/issues/551
- Issue #1980 (specify lines to mutate — closed as implemented): https://github.com/stryker-mutator/stryker-js/issues/1980
- Issue #1472 (ignore specific mutations — closed by the comment syntax): https://github.com/stryker-mutator/stryker-js/issues/1472
- Issue #3229 (ignorer plugin — closed as implemented): https://github.com/stryker-mutator/stryker-js/issues/3229
- Issue #3228 (checker-plugin ignore — closed in favour of #3229): https://github.com/stryker-mutator/stryker-js/issues/3228
- Issue #4141 (more control over mutation context — maintainer points at #3229): https://github.com/stryker-mutator/stryker-js/issues/4141
- Issue #6004 (OPEN: vitest-runner non-deterministic test IDs block committing the incremental baseline; 9.6.1): https://github.com/stryker-mutator/stryker-js/issues/6004
- Stryker.NET configuration (`--since`, `--with-baseline`, for contrast): https://stryker-mutator.io/docs/stryker-net/configuration/

**Google's production mutation system**
- Petrović & Ivanković, "State of Mutation Testing at Google", ICSE-SEIP 2018 (read in full from the PDF): https://research.google.com/pubs/archive/46584.pdf (302s to https://static.googleusercontent.com/media/research.google.com/en//pubs/archive/46584.pdf)
- Petrović, Ivanković, Fraser, Just, "Practical Mutation Testing at Scale: A View from Google", IEEE TSE 2021 (§2.4 the non-blocking sentence; §5 the 26+114 arid rules and the 11%/30% mutant reduction; §7 the 820→77→7 median; the 82%/80→89%/~90% productivity figures; the ~2% compute overhead): https://arxiv.org/abs/2102.11378 — PDF: https://arxiv.org/pdf/2102.11378
- Petrović, Ivanković, Fraser, Just, "Does Mutation Testing Improve Testing Practices?", ICSE 2021 ("achieving mutation adequacy is neither practical nor desirable"; "aiming at mutation adequacy is hopeless"; the productive/unproductive framing; the 4.6-min-per-mutant classification cost): https://homes.cs.washington.edu/~rjust/publ/mutation_testing_practices_icse_2021.pdf

**Equivalent mutants, redundancy, and the cost of triage**

*Verification note, because it matters for how much weight these carry.* Three tiers. **(i) Read
first-hand in this session, from the PDF:** Google ICSE-SEIP 2018, and Papadakis/Shin/Yoo/Bae ICSE
2018. **(ii) Fetched by a sub-agent under a quote-or-say-so contract, at a URL I re-checked and
found live:** Budd & Angluin, Schuler & Zeller, Grün et al., Ammann/Delamaro/Offutt,
Kurtz et al., TCE, TSE 2021, ICSE 2021. **(iii) Fetched by a sub-agent at a URL I could NOT
re-verify:** Jia & Harman, ISSTA 2016, the 2019 survey — canonical landing pages are cited instead
and the figures are flagged. One sub-agent URL for the 2019 survey resolved to an entirely unrelated
paper on re-check and has been removed; treat tier (iii) figures as corroborating, not load-bearing.
Nothing in §9's verdict depends on a tier-(iii) number alone.

- Budd & Angluin, "Two notions of correctness and their relation to testing", Acta Informatica 18(1), 1982 — ETH-hosted scan, live. Note it does **not** directly prove equivalent-mutant undecidability; it assumes program equivalence undecidable and establishes the link (Thms 9, 12): https://archiv.infsec.ethz.ch/intranet_secured/8/0/BA82.pdf
- Schuler & Zeller, "(Un-)Covering Equivalent Mutants", ICST 2010 ("about 45% of all undetected mutants turned out to be equivalent"; "The percentage of equivalent mutants increases as the test suite improves"; 14m28s to classify one) — live: https://www.st.cs.uni-saarland.de/publications/files/schuler-icst-2010.pdf
- Grün, Schuler, Zeller, "The Impact of Equivalent Mutants", Mutation 2009 ("it took us 15 minutes to assess the equivalence of a single mutation") — live: https://www.st.cs.uni-saarland.de/publications/files/gruen-mutation-2009.pdf
- Ammann, Delamaro, Offutt, "Establishing Theoretical Minimal Sets of Mutants", ICST 2014 ("on average, only 1.2% of mutants are in a minimal set") — live: https://cs.gmu.edu/~offutt/rsrch/papers/minimal-mutants.pdf
- Kurtz et al., "Analyzing the Validity of Selective Mutation with Dominator Mutants", FSE 2016 (~0.85% dominators; ~116:1 redundancy) — live: https://cs.gmu.edu/~offutt/rsrch/papers/dominator-mutants.pdf
- Jia & Harman, "An Analysis and Survey of the Development of Mutation Testing", IEEE TSE 37(5), 2011 ("program equivalence is undecidable"; "10% to 40% of mutants which are equivalent") — **tier (iii)**; the CREST PDF mirror refused connections on re-check (ECONNREFUSED 128.16.10.31). Canonical: https://ieeexplore.ieee.org/document/5487526 ; DOI 10.1109/TSE.2010.62
- Papadakis, Henard, Harman, Jia, Le Traon, "Threats to the Validity of Mutation-Based Test Assessment", ISSTA 2016 ("fewer than 5% of all mutants are subsuming") — **tier (iii)**; ACM and UCL Discovery both 403'd my re-check. Canonical: https://dl.acm.org/doi/10.1145/2931037.2931040
- Papadakis, Kintis, Zhang, Jia, Le Traon, Harman, "Mutation Testing Advances: An Analysis and Survey", Advances in Computers 112, 2019 ("only few of the mutants produced (approximately 5%) is practically useful") — **tier (iii)**; no free full text I could verify. Canonical: https://www.sciencedirect.com/science/article/pii/S0065245818300305 (403 to fetch) ; dblp: https://dblp.org/rec/journals/ac/PapadakisK00TH19.html
- Papadakis, Jia, Harman, Le Traon, "Trivial Compiler Equivalence", ICSE 2015: https://discovery.ucl.ac.uk/1499169/1/Jia_Trivial_Compiler_mutation-testing-papadakis-icse15.pdf (~30% of equivalent mutants detected; >7% of all mutants equivalent, 21% duplicated)
- Papadakis, Shin, Yoo, Bae, "Are Mutation Scores Correlated with Real Fault Detection?", ICSE 2018 (read from the PDF; the undecidability + manual-identification statement, the weak-correlation result, and the "<1% of mutants" noise finding): https://coinse.github.io/publications/pdfs/Papadakis2018hi.pdf — ACM: https://dl.acm.org/doi/10.1145/3180155.3180183

**Other mutation tools**
- arcmutate git integration (change-based mode, default scope = line): https://docs.arcmutate.com/docs/git-integration.html
- arcmutate exclusions (`.pitest.exclude` CSV: file, class, method, mutator, line range): https://docs.arcmutate.com/docs/exclusions.html
- arcmutate GitHub integration (advisory by default; `LEVEL` makes it blocking): https://docs.arcmutate.com/docs/github/overview.html
- pitest quickstart (`mutationThreshold`, `excludedMethods`, `avoidCallsTo`): https://pitest.org/quickstart/maven/
- pitest README changelog (SCM goal deprecated #1353, removed #1379; "introduce equivalent status" #1471): https://github.com/hcoles/pitest/blob/master/README.md
- Mull incremental mutation testing (git-diff, line-scoped): https://mull.readthedocs.io/en/latest/IncrementalMutationTesting.html
- Cosmic Ray filters (`cr-filter-git`, `cr-filter-pragma`, `cosmic-ray-spor-filter`): https://cosmic-ray.readthedocs.io/en/stable/how-tos/filters.html
- spor (anchored metadata designed to survive edits): https://github.com/abingham/spor
- mutmut (incremental re-test; no threshold gate found): https://mutmut.readthedocs.io/

**Diff-scoped gating**
- Sonar, Clean as You Code: https://docs.sonarsource.com/sonarqube-server/10.5/user-guide/clean-as-you-code
- Sonar, quality gates ("focuses on keeping high quality standards for new code"): https://docs.sonarsource.com/sonarqube-server/quality-standards-administration/managing-quality-gates/introduction-to-quality-gates
- Sonar, defining new code (90-day cap): https://docs.sonarsource.com/sonarqube-server/10.6/project-administration/clean-as-you-code-settings/defining-new-code
- Sonar, managing issues (accepted issues as the per-issue escape hatch): https://docs.sonarsource.com/sonarqube-server/10.6/user-guide/issues/managing
- Codecov commit status (project vs patch): https://docs.codecov.com/docs/commit-status
- Codecov blog, why patch coverage matters **[secondary — maintainer blog, not reference docs]**: https://about.codecov.io/blog/why-patch-coverage-is-more-important-than-project-coverage/
- golangci-lint configuration (`new`, `new-from-rev`, `new-from-merge-base`, `whole-files`): https://golangci-lint.run/docs/configuration/file/
- diff-cover: https://github.com/Bachmann1234/diff_cover
- undercover (changed methods/blocks; explicit legacy framing): https://github.com/grodowski/undercover
- GitLab code coverage (annotations diff-scoped; gate is a delta, not a diff): https://docs.gitlab.com/ci/testing/code_coverage/
- Danger JS (framework for diff-scoped rules): https://danger.systems/js/

**Baselines & suppression files**
- PHPStan baseline ("The life goal of a baseline file is to not exist"): https://phpstan.org/user-guide/baseline
- Mirtes, "PHPStan's baseline feature lets you hold new code to a higher standard": https://medium.com/@ondrejmirtes/phpstans-baseline-feature-lets-you-hold-new-code-to-a-higher-standard-e77d815a5dff
- Psalm, dealing with code issues (`--update-baseline` cannot add): https://psalm.dev/docs/running_psalm/dealing_with_code_issues/
- Psalm's own committed baseline (keying = file + issue type + code snippet): https://github.com/vimeo/psalm/blob/master/psalm-baseline.xml
- ESLint, introducing bulk suppressions (keying = file → rule → count; the attribution admission): https://eslint.org/blog/2025/04/introducing-bulk-suppressions/
- ESLint v9.24.0 release notes: https://eslint.org/blog/2025/04/eslint-v9.24.0-released/
- ESLint suppressions docs (`--prune-suppressions`): https://eslint.org/docs/latest/use/suppressions
- Android lint baseline ("suppress the gate, never the feedback"): https://developer.android.com/studio/write/lint
- Checkstyle SuppressionFilter (regex-keyed): https://checkstyle.org/filters/suppressionfilter.html
- Error Prone flags (severity demotion + path exclusion, no occurrence baseline): https://errorprone.info/docs/flags
- NullAway configuration (package-scoped adoption): https://github.com/uber/NullAway/wiki/Configuration

**Ratchets**
- Kua, "An Appropriate Use of Metrics" (the canonical definition of ratcheting), martinfowler.com: https://martinfowler.com/articles/useOfMetrics.html
- betterer introduction (auto-tighten on improvement, fail on regression): https://phenomnomnominal.github.io/betterer/docs/introduction
- betterer issue #1181 (ratchet stops holding once a goal is met) **[reporter's account; no maintainer confirmation on the page]**: https://github.com/phenomnomnominal/betterer/issues/1181

**Industrial adoption / gating**
- Zenseact, "Mutation Testing in Practice: Insights From [an] Automotive Industry Case Study" (the threshold-gate temptation to "cheat the score") — **landing page only; full text not reachable** **[secondary]**: https://ieeexplore.ieee.org/document/10371613
- Meta, mutation-guided test improvement / "Mutation Monkey" (review-time surfacing, not gating; the *"We are never going to land this diff"* reviewer quote) — **[secondary; the engineering.fb.com permalink I was given 404s on re-check, so this is reported as a sub-agent finding I could not verify]**

**Could not reach / negative findings (stated rather than paraphrased)**
- **No peer-reviewed report of a mutation gate that *blocks* merge was found.** Every industrial deployment located (Google, Meta, arcmutate's default, Zenseact's discussion) is advisory or human-escalated. Absence of a found source, not proof of absence — but the sweep was deliberate.
- The full TSE 2021 text was read from the arXiv PDF; the ACM version was not fetched. ICSE 2021 was read from the author-hosted PDF.
- StrykerJS docs do **not** state whether `thresholds.break` applies to the merged `--incremental` report. Reported as an absence; D4a's claim stands on this repo's measurement, not on documentation.
- No dedicated StrykerJS page on "adopting mutation testing on a legacy codebase" or "CI on changed files only" was found. Absence of a found page, not proof of absence.
- pitest PR #1471 ("introduce equivalent status") has an empty description; its mechanics are unconfirmed.
- `arcmutate.com` (the marketing site) is a JS-rendered SPA and returned only its tagline; all arcmutate claims above come from `docs.arcmutate.com`, which served fine.
- Sonar's `…/latest/core-concepts/clean-as-you-code/introduction/` 404s; versioned URLs (10.5/10.6) were substituted and are the ones cited.
- The ThoughtWorks Technology Radar has **no** technique named "ratcheting"; the martinfowler.com/Kua article is the citation that holds.
- PHPStan issue #3648's "no line numbers to avoid merge conflicts" rationale appears only as the *reporter's* assumption, with no maintainer reply on the page.
</content>
</invoke>
