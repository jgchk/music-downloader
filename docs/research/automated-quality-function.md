# How do you improve an automated quality function — the gate that replaces human code review?

**Research date:** 2026-08-05. All URLs accessed 2026-08-05 unless noted. Findings are input to a
decision, not normative until adopted.

**Question.** This repo is built almost entirely by AI agents with the human as product owner, not
reviewer. Quality is enforced by an automated pipeline: `pnpm check` (format → lint → typecheck →
build → test w/ 100% coverage → contract → release → bridge tiers), an ESLint flat config with
typed rules + unicorn + import-boundary zones encoding the hexagonal dependency rule, a written
constitution in `docs/development/*.md`, ~9 custom LLM review agents encoding that constitution,
and a `/ship` loop that reviews to zero-findings convergence before merge. The maintainer wants
the best bang-for-buck improvement to this "automated quality function," with a mild leaning
toward adding a deterministic analyzer "above linting" (SonarQube or similar). Three forks:
(a) do SonarQube-class analyzers find real defects beyond strict typed ESLint + 100% coverage on
TypeScript? (b) is "promote recurring English constitution/review findings into machine rules" an
attested deliberate pipeline? (c) what does the field say is higher-value that is not on the
table yet?

**Method.** Repo state verified directly (`eslint.config.js`, `package.json`, `.claude/agents/`,
sibling docs under `docs/research/`) rather than taken from the prompt. Primary sources fetched
2026-08-05: Google's *Software Engineering at Google* static-analysis chapter (abseil.io, the
publicly readable edition of the Tricorder material; the CACM 2018 article itself returned HTTP
403 to fetches, noted where relevant), the Tricorder ICSE 2015 paper listing (research.google
PDF), the Facebook/Meta CACM 2019 paper (landing pages fetched; the 70%-vs-0% fix-rate figures
confirmed via search excerpts of the paper text because cacm.acm.org 403s robots — marked
[confirmed-via-excerpt] below), Google's mutation-testing papers (research.google, arXiv,
UW-hosted PDFs), Inozemtseva & Holmes ICSE 2014, Lenarduzzi et al. SANER 2020 (arXiv), the
Amazon S3 ShardStore SOSP 2021 paper (author-hosted PDF), StrykerJS incremental-mode docs
(stryker-mutator.io), fast-check docs (fast-check.dev), the SonarJS GitHub repo, Semgrep/Opengrep
licensing coverage (Socket, The New Stack, InfoQ, Aikido), GitHub CodeQL licensing docs,
fbinfer.com, Deming Institute, Reason BMJ 2000 (PubMed), and 2025–26 arXiv work on LLM-as-judge
for code. npm registry facts queried via `npm view` (npmjs.com blocks fetches). Citations
inline; sources gathered in §9.

---

## 1. House facts being decided against (verified in-repo)

- The typed lint tier is `tseslint.configs.recommendedTypeChecked`, **not** `strict`
  (`eslint.config.js:197`) — the prompt's framing of "strict+typed" overstates today's config.
  typescript-eslint's `strictTypeChecked` superset is an unshipped free increment sitting inside
  the tool already installed.
- Enforcement stack: unicorn `recommended` (`eslint.config.js:139`), `import/no-restricted-paths`
  zones for layer/module/aggregate boundaries (`eslint.config.js:215-217`), files-scoped
  `no-restricted-imports` bans, svelte flat recommended. Known gaps (≈65 out-of-src TS files
  unlinted/untypechecked, no discarded-Result rule, zones skip `.svelte`) are already researched
  and settled in `docs/research/result-lint-and-tier-enforcement.md` (2026-08-05) — this doc does
  not re-argue them, but they are prerequisites: a quality function with unlinted tiers has holes
  before any new tool is added.
- Five repo-local review agents (`.claude/agents/`: solid-reviewer, test-quality-reviewer,
  type-altitude-reviewer, bounded-context-reviewer, contract-test-reviewer) plus the
  pr-review-toolkit plugin set; the `/ship` skill runs implement → multi-agent review → apply →
  re-review to zero findings → merge → deploy → verify.
- The gate: `pnpm check` = format → lint → typecheck → build → `test:cov` (vitest, 100% line
  coverage) → contract (recorded third-party fixtures) → release-tooling tests → Python bridge
  tier (`package.json`). Out-of-process e2e runs on main. Renovate PRs auto-merge on green
  checks (repo memory).
- Constraints: headless in CI, self-hostable, no per-seat SaaS; Node ≥24, pnpm, vitest, jj
  (git-backed); false positives are poison because nobody is standing by to triage them.

## 2. What the efficacy literature actually says about "more static analysis"

The central empirical corpus here is Google's and Meta's decade of production data, and it is
strikingly consistent on one meta-finding: **deployment model and false-positive discipline
dominate analyzer power.**

- **Tricorder (Google).** Analyzers must "produce less than 10% effective false positives," where
  an *effective* false positive is any report the developer takes no positive action on — a
  technically-correct-but-ignored warning counts. Google's fleet runs just below 5% overall.
  Findings are delivered at code-review time because the developer is "already in a change
  mindset"; earlier attempts (FindBugs dashboards, batch lists) failed and Tricorder "came out of
  several failed attempts to integrate static analysis with the developer workflow" (SWE at
  Google, ch. 20; Sadowski et al., ICSE 2015; the CACM 2018 write-up "Lessons from Building
  Static Analysis Tools at Google" is the canonical citation — cacm.acm.org 403'd, content read
  from the abseil.io book chapter by the same team).
- **Infer (Meta).** Same shape, sharper numbers: batch deployment (nightly run, issues filed to
  developers, FP rate already under 20%) produced a fix rate near **0%**; the identical analyzer
  moved to diff time produced a fix rate over **70%**, and >100k reported issues have been fixed
  pre-production (Distefano et al., CACM 2019) [70%/0% confirmed-via-excerpt].
- **Defect prediction.** Google deployed a bug-prediction algorithm across the company and found
  "no identifiable change in developer behavior" (Lewis et al., ICSE 2013). Option-(c) candidate
  "defect prediction" is attested *negative* prior art — skip it.
- **SonarQube rule efficacy.** The main empirical study, Lenarduzzi et al. SANER 2020 ("Are
  SonarQube Rules Inducing Bugs?", 21 mature OSS Java projects, SZZ fault-labeling): of 202 Java
  rules only ~25 showed even relatively low fault-proneness; violations SonarQube itself labels
  "bugs" were "generally not fault-prone," and the fault-prediction power of SonarQube's model
  was "extremely low." Java, not TS — transferability caveat — but it is the only direct
  empirical test of the Sonar rule set found, and it points down.

Implication for this repo: the gate is already a diff-time deployment (every commit), which is
the attested-good shape. The literature gives no support for expecting a *generic* extra
analyzer to find a meaningful defect stratum above strict typed lint + enforced tests; it gives
strong support for keeping effective-FP near zero, because in an unattended loop an ignored
analyzer isn't just wasted — an agent instructed to "make the gate pass" will appease it, which
is worse than noise.

## 3. Option (a): the deterministic-analyzer candidates, tool by tool

- **SonarQube.** Its JS/TS analysis engine *is* SonarJS, and the SonarJS repo "now hosts
  eslint-plugin-sonarjs, our plugin for ESLint" (github.com/SonarSource/SonarJS) — i.e. the
  bug-detection rules SonarQube would run on this codebase are available as an ESLint plugin
  (`eslint-plugin-sonarjs` 4.2.0 on npm) inside the existing `pnpm check`, no server, no
  dashboard, no jj-vs-git friction. The Sonar community itself documents that many
  sonarjs rules duplicate ESLint core / typescript-eslint rules (Sonar Community thread
  "Documenting and clarifying duplicate ESLint rules"). What the server adds beyond the plugin —
  quality-gate dashboards, history, duplication metrics — is inspection UI for humans this
  pipeline deliberately doesn't have. Combined with §2's efficacy evidence: **the server is not
  worth adopting; the rule set is worth a cheap trial as a plugin**, expecting mostly overlap
  plus a residue of genuine additions (a handful of sonarjs rules — e.g. its cognitive-complexity
  rule — are already in use here: `eslint.config.js:150` discusses a complexity threshold).
- **Semgrep.** Engine remains LGPL-2.1, but since Dec 2024 the maintained rule packs are under
  the restrictive "Semgrep Rules License v1.0" (internal use allowed; features like fingerprints
  migrated out of the community edition); a vendor coalition forked it as **Opengrep** (Jan 2025,
  LGPL, restored taint analysis etc.) (Socket, The New Stack, InfoQ, Aikido). Self-hostable and
  headless either way. But for *this* stack its public TS rules are overwhelmingly security-shaped
  (injection, secrets, crypto misuse) — a thin surface for a homelab app whose inputs are its own
  UI and slskd. Value here is not the rule packs but the engine as a *custom-rule vehicle*
  (see §4).
- **CodeQL.** Free for public repositories (this repo is public — repo memory: made public for
  branch-protection rulesets); private use requires GitHub Advanced Security / Code Security
  (~$30/committer/mo) (GitHub docs; InfoWorld). Runs headless as an Actions job. Its TS suites
  are again security-dominant. Conditional: acceptable as a free advisory Actions job while the
  repo stays public; it violates the self-hostable preference the day the repo goes private.
- **Meta Infer.** Analyzes "Java, C, C++, Objective-C, and Erlang" (fbinfer.com; Wikipedia). No
  TypeScript. Ruled out on fact.

## 4. Option (b): English-rule → machine-rule promotion — attested, under several names

The pipeline the maintainer is groping toward ("collapse constitution rules into lint rules;
every recurring review finding becomes a rule") is not novel; it is the load-bearing pattern in
three independent literatures:

- **Tricorder's crowdsourced analyzers.** Google explicitly scales static analysis "by
  crowdsourcing analysis development": domain experts turn recurring review nits into checkers,
  and the platform's contract (actionable, <10% effective FP, easy fix) governs admission (SWE at
  Google ch. 20; ICSE 2015). The unit of progress is *a review comment retired into a check*.
- **Architectural fitness functions.** Ford/Parsons/Kua define a fitness function as "an
  objective integrity assessment of some architectural characteristic," insist governance be
  "continuous and automated, not episodic and manual," and locate them in the deployment
  pipeline, preferably as fast local tests (Building Evolutionary Architectures, ch. 2;
  Thoughtworks). This is the exact named concept for "automated quality function"; the repo's
  import-zones, contract tier, coverage gate, and e2e are textbook atomic/holistic fitness
  functions. The book's recommended *evolution* mechanism is precisely option (b): each newly
  discovered architectural concern gets encoded as a new executable function.
- **Statistical process control.** Deming's Point 3: "Cease dependence on inspection to achieve
  quality. Eliminate the need for inspection on a mass basis by building quality into the
  product in the first place" (deming.org). Per-PR LLM review is inspection of the artifact;
  a promoted lint rule is a process control. The manufacturing literature is unambiguous that
  the second compounds and the first doesn't.

Mechanically, promotion targets in this stack, in ascending power (the compiler-ladder framing —
each tier subsumed by a stronger one): `no-restricted-imports`/`no-restricted-syntax` (cheap,
AST-pattern-shaped constitution clauses) → custom flat-config rule in-repo (ESLint supports local
plugins; the repo already ships bespoke zone tables) → Semgrep/Opengrep rule where dataflow is
needed → **type-level unavailability** (branded types, exhaustive unions — several already
shipped here), which is the only tier with a 0% false-negative *and* 0% false-positive rate.
Sister evidence that promotion is live here already: the sibling research doc trial-ran a
neverthrow-must-use plugin against the repo before recommending it
(`docs/research/result-lint-and-tier-enforcement.md` §Method) — that "measure violations before
adopting" step is exactly Tricorder's admission contract in miniature.

## 5. Option (c): what the field rates higher than another analyzer

### 5.1 Mutation testing — the strongest evidenced gap

The 100%-line-coverage gate measures *execution*, not *assertion*. Inozemtseva & Holmes (ICSE
2014, ACM Distinguished Paper): across five large Java systems, coverage correlates only low-to-
moderately with suite effectiveness once suite size is controlled, and "stronger forms of
coverage do not provide greater insight." Google's own coverage paper agrees coverage is useful
mainly as a changeset-level review signal, not a sufficiency proof (Ivanković et al., FSE 2019).
The direct fix is mutation score. Google's production system (Petrović & Ivanković, ICSE-SEIP
2018; Petrović et al., TSE 2021; ICSE 2021) made it tractable with exactly the constraints this
repo has: mutate only changed, covered lines; suppress "arid" (uninteresting) lines; at most one
mutant per line; surface at review time. Measured effect: developers exposed to mutants write
more tests and their changes carry significantly fewer live mutants (ICSE 2021). For an agent
pipeline this converts directly: a surviving mutant is a machine-checkable, zero-ambiguity
finding an agent can be looped on — unlike an LLM reviewer's prose finding, it cannot be argued
with. TS implementation: **StrykerJS** with `--incremental` (caches results in
`reports/stryker-incremental.json`, reuses e.g. 3,731 of 3,965 mutant results in its docs'
example, resumable) — though note its vitest runner has only *partial* incremental support
("tests per file without location"), so per-test filtering is coarser than with Jest
(stryker-mutator.io/docs/stryker-js/incremental). Fits the gate as a CI job keyed on the diff;
the 100%-coverage precondition actually makes mutation cheap-*er* here, since Google's approach
only mutates covered lines and everything is covered.

### 5.2 Property-based + model-conformance testing for the event-sourced core

The decide/evolve deciders are pure functions over algebraic state — the ideal PBT substrate.
The attested industrial pattern is Amazon S3's ShardStore (Bornholt et al., SOSP 2021,
"lightweight formal methods"): write an executable **reference model** in the implementation
language, then property-test the implementation's conformance to it; result: 16 issues (incl.
crash-consistency and concurrency) prevented from reaching production, and the approach was
maintainable by non-formal-methods engineers because the model lives next to the code. Mapping
here: a reference model of an aggregate (e.g. "fold of events ≙ decider state; no command
sequence reaches an illegal state; evolve is total over every recorded event version") checked
with **fast-check** (4.9.0; `@fast-check/vitest` 0.4.1 integrates with the existing runner).
fast-check is deterministic under a fixed seed, prints seed/path/replayPath on failure for exact
reproduction, and ships model-based (commands) testing and race-condition detection natively
(fast-check.dev) — answering the CI-flakiness objection. This buys a slice of what TLA+ would,
without a second language or toolchain, which matches the SOSP paper's own argument for choosing
PBT-against-model over full verification.

### 5.3 LLM-as-judge — the layer already in place, and its measured limits

2025–26 empirical work says: LLM judges still "fall significantly short of human-level
reliability" with failures in functional-equivalence recognition and bias mitigation (WebDevJudge,
arXiv 2510.18560); frontier models exceed 50% error rates on adversarial bias tests and
multi-agent debate *amplifies* bias after round one (JudgeBiasBench line of work, arXiv
2604.16790; EMNLP 2025); and — most actionable — **explicit evaluation criteria are the dominant
reliability lever**, with chain-of-thought adding little once criteria are clear (arXiv
2506.13639). Read against this repo: constitution-encoding agents with narrow charters
(solid-reviewer's port-contract checklist, type-altitude's per-layer rules) are the evidence-
aligned design; a generic "review this PR" ensemble is the evidence-misaligned one. The
convergence loop (re-review to zero findings) has no direct study; treat §7.

### 5.4 Adjacent-domain convergence

Deming (§4) and Reason's Swiss-cheese model (BMJ 2000: layered defences each with holes; harm
requires the holes to align) converge on the same two prescriptions: (1) push checks upstream
into the process, (2) prefer *diverse* independent layers over thickening one layer. The current
gate is many slices of the same two cheeses — static checks and example-based tests. Mutation
testing (attacks assertion quality), model-conformance PBT (attacks specification conformance),
and contract/e2e (already present, attack integration) are *different* cheeses; a second
general-purpose linter is another slice of an existing one, with correlated holes.

## 6. Attested vs. unattested in the current design

**Attested (named prior art):**
- The whole gate = *architectural fitness functions*, continuously enforced in-pipeline
  (Ford/Parsons/Kua).
- Every-commit enforcement = *diff-time deployment*, the shape both Google and Meta found
  necessary for findings to be acted on (CACM 2018/2019).
- Import-zone lint enforcing hexagonal layering = ArchUnit-style architecture tests (TS
  ecosystem equivalents: ts-arch, ArchUnitTS, dependency-cruiser) implemented as lint — same
  fitness-function category.
- Review-finding → lint-rule promotion = Tricorder's crowdsourced-checker model + Deming Point 3.
- Recorded-fixture contract tier = consumer-driven-contract practice; auto-merge-on-green
  Renovate = the standard checks-gated bot-merge pattern.
- Narrow-charter, criteria-explicit review agents = the one design choice the LLM-as-judge
  literature actively endorses (criteria dominate reliability).

**Unattested / frontier (flag as risk):**
- *Zero* human review with LLM reviewers as the only judgment layer. Google/Meta automate
  *around* human review, not instead of it; the 2026 practitioner literature (Codacy, The New
  Stack, Harness et al.) is converging on "automated gates + risk-based human review," not zero
  review — and those are vendor/practitioner blogs, not studies [secondary]. No published
  empirical evaluation of an agent-review-to-convergence loop was found.
- Review-to-zero-findings convergence as a stopping rule. Closest analogue is Meta's diff-time
  bot iteration, but with humans deciding. Known theoretical hazard: judge bias amplification in
  multi-round agent debate (EMNLP 2025) suggests convergence can mean *agreement*, not
  *correctness*.
- Reviewer-agents-encoding-a-constitution has no study literature at all yet; it is a genuine
  frontier this repo is running ahead of.

## 7. Verdict

Ranked by bang-for-buck for this repo:

1. **StrykerJS incremental mutation testing in CI** (per-diff or nightly-with-cache, advisory →
   then gating on changed-code mutation score). Directly attacks the one measured weakness of
   the current gate — 100% line coverage does not imply assertion strength (Inozemtseva & Holmes
   2014) — with Google-scale evidence that surviving mutants change test-writing behavior
   (TSE 2021, ICSE 2021) and a self-hosted TS tool built for exactly this (StrykerJS
   incremental). Mutants are deterministic findings an agent can be looped on unattended.
2. **Finish the enforcement-gap backlog + raise typed lint to `strictTypeChecked`.** Zero new
   tools: the sibling doc's gaps (unlinted tiers, discarded-Result rule, svelte zones) plus the
   `recommendedTypeChecked`→`strictTypeChecked` bump are free, deterministic wins inside plugins
   already paid for.
3. **Institutionalize the promotion ladder (option b) with Tricorder's admission contract.**
   Every recurring review-agent finding gets triaged: restricted-syntax rule → local custom
   ESLint rule → (dataflow) Opengrep rule → type-level unrepresentability; admit a rule only if
   actionable with near-zero effective FP, and measure violations against the repo before
   adoption (as `result-lint-and-tier-enforcement.md` already modeled). This is the compounding
   loop; each promotion permanently shrinks the LLM reviewers' job.
4. **Model-conformance property tests for the deciders** with fast-check/vitest, following the
   S3 ShardStore pattern (executable reference model, seeded/deterministic, replayPath on
   failure). Highest marginal value on the event-sourced core: upcaster totality, fold/decide
   invariants, command-sequence safety.
5. **Trial `eslint-plugin-sonarjs` as a plugin, not SonarQube as a server** — one scratch run,
   count non-duplicative true positives, keep only individually justified rules (Tricorder
   contract again).

**The SonarQube leaning: skip the server; conditional-adopt the rules as ESLint plugin.** The
axis it turns on: SonarQube's TS engine is literally distributed as an ESLint plugin
(SonarSource/SonarJS), so the server adds only human-facing dashboards this pipeline has no
consumer for; and the only empirical study of Sonar rule efficacy found their "bug" rules
generally not fault-prone (SANER 2020, Java). If a plugin trial on this codebase surfaces real
defects, adopt those rules; expect mostly overlap with typescript-eslint. CodeQL: optional free
advisory Actions job while the repo is public; drop if it ever goes private. Infer: no TS —
ruled out.

**Pitfall checklist from the sources:**
- *Ignored-analyzer death spiral*: any check whose findings aren't acted on trains the loop to
  route around it; enforce the <10% effective-FP admission bar and delete checks that miss it
  (Tricorder). In an agent loop the failure mode is worse than ignoring: appeasement (test
  fiction to satisfy a metric) — the existing test-quality-reviewer charter ("no fiction tests
  to feed the 100% gate") is the right countermeasure; extend it to mutation score if gated.
- *Unproductive/arid mutants*: mutate only changed covered lines, suppress arid lines, cap
  mutants per line, or mutation testing drowns in noise (Google ICSE-SEIP 2018).
- *Batch findings die*: never accumulate a backlog dashboard; findings must land on the diff
  that caused them (CACM 2019's 70%-vs-0%).
- *PBT flakiness*: pin seeds in CI or log them; always keep replayPath repro; keep generators
  away from wall-clock and I/O (fast-check docs).
- *Judge bias amplification*: multi-round agent debate amplifies bias (EMNLP 2025); prefer
  independent narrow judges + deterministic tiebreakers over judges reading each other.
- *Metric fixation*: coverage (and mutation score) are proxies; Goodhart applies to whatever the
  gate maximizes — diversity of layers (Swiss cheese) is the structural hedge (Reason 2000).

**Honesty about thin coverage.** The core question — can LLM reviewers + deterministic gates
fully replace human review — has no direct empirical literature as of 2026-08. The LLM-as-judge
studies measure judgment against human ground truth on benchmarks, not end-to-end defect
escape rates of agent-reviewed production systems; the practitioner material is vendor blogs
[secondary]. Everything above the LLM layer in this doc is well-evidenced; the LLM layer itself
is running on plausibility plus this repo's own (real but uncontrolled) track record. That
argues for the ranking above: strengthen the deterministic floor (mutation, PBT, promotion)
precisely because the judgment layer is the unproven one.

## 8. Cross-references

- `docs/research/result-lint-and-tier-enforcement.md` — the concrete lint/tier gap closures this
  doc ranks as move #2; also the in-house exemplar of measure-before-adopt.
- `openspec/changes/close-enforcement-gaps/` — active change already carrying part of that work.

## 9. Sources

Static analysis efficacy
- Software Engineering at Google, ch. 20 "Static Analysis" (Tricorder; effective-FP definition, <10% bar, ~5% fleet rate, review-time integration): https://abseil.io/resources/swe-book/html/ch20.html
- Sadowski et al., "Tricorder: Building a Program Analysis Ecosystem," ICSE 2015: https://research.google.com/pubs/archive/43322.pdf
- Sadowski et al., "Lessons from Building Static Analysis Tools at Google," CACM 61(4), 2018: https://dl.acm.org/doi/10.1145/3188720 (cacm.acm.org fetch returned 403; content read via the abseil chapter above)
- Distefano et al., "Scaling Static Analyses at Facebook," CACM 62(8), 2019: https://cacm.acm.org/research/scaling-static-analyses-at-facebook/ (403 to fetch; 70% diff-time vs ~0% batch fix rate confirmed via excerpts; abstract via https://research.facebook.com/publications/scaling-static-analyses-at-facebook/)
- Lewis et al., "Does Bug Prediction Support Human Developers? Findings from a Google Case Study," ICSE 2013: https://research.google/pubs/does-bug-prediction-support-human-developers-findings-from-a-google-case-study/
- Lenarduzzi et al., "Are SonarQube Rules Inducing Bugs?," SANER 2020: https://arxiv.org/abs/1907.00376

Coverage & mutation
- Inozemtseva & Holmes, "Coverage Is Not Strongly Correlated with Test Suite Effectiveness," ICSE 2014: https://www.cs.ubc.ca/~rtholmes/papers/icse_2014_inozemtseva.pdf
- Ivanković et al., "Code Coverage at Google," ESEC/FSE 2019: https://research.google/pubs/pub48413/
- Petrović & Ivanković, "State of Mutation Testing at Google," ICSE-SEIP 2018: https://research.google.com/pubs/archive/46584.pdf
- Petrović et al., "Practical Mutation Testing at Scale: A View from Google," IEEE TSE 2021: https://arxiv.org/abs/2102.11378
- Petrović et al., "Does Mutation Testing Improve Testing Practices?," ICSE 2021: https://homes.cs.washington.edu/~rjust/publ/mutation_testing_practices_icse_2021.pdf
- StrykerJS incremental mode: https://stryker-mutator.io/docs/stryker-js/incremental/

Property-based / lightweight formal methods
- Bornholt et al., "Using Lightweight Formal Methods to Validate a Key-Value Storage Node in Amazon S3," SOSP 2021: https://www.cs.utexas.edu/~bornholt/papers/shardstore-sosp21.pdf
- fast-check (determinism, model-based testing, replay): https://fast-check.dev/docs/advanced/model-based-testing/ and https://github.com/dubzzz/fast-check

Tools & licensing
- SonarSource/SonarJS (hosts eslint-plugin-sonarjs; SonarQube's JS/TS analyzer): https://github.com/SonarSource/SonarJS
- Sonar Community, "Documenting and clarifying duplicate ESLint rules": https://community.sonarsource.com/t/documenting-and-clarifying-duplicate-eslint-rules/129385
- Semgrep license shift & Opengrep fork: https://socket.dev/blog/opengrep-forks-semgrep ; https://thenewstack.io/opengrep-launches-as-free-fork-after-semgrep-license-shift/ ; https://www.infoq.com/news/2025/02/semgrep-forked-opengrep
- CodeQL CLI licensing (public free, private needs GHAS): https://docs.github.com/en/code-security/codeql-cli/getting-started-with-the-codeql-cli/about-the-codeql-cli
- Meta Infer language support (no TS): https://fbinfer.com/docs/about-Infer/
- ts-arch / ArchUnitTS (TS architecture-test equivalents): https://github.com/ts-arch/ts-arch ; https://github.com/LukasNiessen/ArchUnitTS

Fitness functions & adjacent domains
- Ford, Parsons, Kua, Building Evolutionary Architectures, ch. 2 "Fitness Functions": https://www.oreilly.com/library/view/building-evolutionary-architectures/9781491986356/ch02.html
- Thoughtworks, "Fitness function-driven development": https://www.thoughtworks.com/insights/articles/fitness-function-driven-development
- Deming Institute, "Dr. Deming's 14 Points" (Point 3): https://deming.org/explore/fourteen-points/
- Reason, "Human Error: Models and Management," BMJ 2000: https://pubmed.ncbi.nlm.nih.gov/10720363/

LLM-as-judge / agentic review (young field — benchmarks, not production studies)
- WebDevJudge (judge-vs-human gap): https://arxiv.org/html/2510.18560v1
- Bias in the Loop: Auditing LLM-as-a-Judge for SE (bias-test error rates; debate amplification): https://arxiv.org/html/2604.16790v1
- "An Empirical Study of LLM-as-a-Judge: How Design Choices Impact Evaluation Reliability" (criteria dominate): https://arxiv.org/abs/2506.13639
- "Reliability without Validity: … LLM-as-a-Judge Models" : https://arxiv.org/pdf/2606.19544
- Practitioner state of the art [secondary]: https://blog.codacy.com/code-review-is-dead-why-ai-generated-code-needs-verification-not-human-approval ; https://thenewstack.io/ship-code-without-verification/
