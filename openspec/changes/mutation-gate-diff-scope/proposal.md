# Proposal: mutation-gate-diff-scope

## Why

The mutation gate ships inert. `mutation-gate` left `continue-on-error: true` on the Stryker
step and the check unrequired, and made the flip conditional on main becoming mutant-clean —
a precondition `docs/research/blocking-mutation-gate-scope.md` (2026-08-07) establishes is
**unreachable in principle**, not merely unreached. The equivalent fraction among survivors
*rises* as a suite improves (Schuler & Zeller, ICST 2010); under 5% of mutants carry unique
information at all (subsumption studies); Google calls mutation adequacy *"neither practical
nor desirable"* and aiming at it *"hopeless"* (ICSE 2021). So the current plan waits forever,
while the advisory channel it waits behind has already been observed dead on this repository:
v3.18.0 shipped **45 surviving mutants** into a step summary nothing consumed.

The research's verdict is that the failure scope, not the burn-down, is the thing in the way.
Diff/changed-**line** scoping is the attested answer for gating a metric on a codebase that
cannot reach the metric's ceiling — Google (*"Only lines affected by the diff under review
that are covered and are not arid are mutated"*), arcmutate, Mull and Cosmic Ray in mutation
testing; Sonar, Codecov, golangci-lint and diff-cover in the adjacent coverage problem. Where
granularity is stated anywhere, **line is the default and file is the deliberate widening** —
the reverse of what shipped here. Under line scope the seventeen recorded equivalents stop
blocking without being suppressed, and a mutant on a line no PR touched cannot fail that PR.

This change moves the failure scope and ships the verdict in **shadow mode**, because
`docs/development/quality-gates.md` admits a check only under ten percent effective false
positives *measured on this repository* — and Google, after years of tuning, sits at 82–89%
mutant productivity against a ~90% target, i.e. *at* this repo's bar rather than comfortably
inside it, with a human "Not useful" button this factory does not have. Measuring first is
the same method `result-lint-and-tier-enforcement.md` used before adopting a lint rule.

## What Changes

- **A new verdict step** in the `mutation` job fails only when a surviving mutant's span
  **overlaps** a line the branch added or modified, computed from `git diff -U0` against the
  same merge-base the scope step already resolves. Overlap, not Stryker's containment: a
  whole-block mutant covering a function you edited one line of still counts. Statement-block
  removal is 72.18% of Google's mutants and the mutation type second-least likely to survive,
  so dropping it silently would be a large hole.
- **Reporting scope stays the changed files.** Android lint's rule: *suppress the gate, never
  the feedback.* The step summary keeps the full file-scoped inventory; only the verdict
  narrows.
- **Shadow mode is the shipped first state.** The verdict step computes its decision, prints
  it to the step summary, and does not fail the job. A single documented switch
  (`MUTATION_GATE_ENFORCE`) flips it to enforcing — a flag, not a rewrite — and a task
  collects the effective-false-positive measurement on real PRs *here* before that flip.
- **Once enforcing, the verdict fails on three conditions, not one**: a survivor overlapping a
  changed hunk; a missing or unreadable report; and a scope that analysed zero mutants.
  `report-model.ts` already models every "no report" case and `summarize.ts` already detects
  the all-ignored case — both are reused. A Stryker crash must never read as a green gate.
- **`continue-on-error` MOVES rather than disappears.** It stays on the Stryker step precisely
  *because* that step's exit code stops being the verdict; the new verdict step carries the
  decision and does not have the flag. The artifacts say this plainly instead of describing a
  removal.
- **Variant (B) is recorded as the named tuning lever** — range-scoping the run itself with
  `--mutate 'path:start-end,…'` (native since StrykerJS v4.6.0, and the maintainer's own
  recommendation for diff gating), to be taken when wall-clock becomes binding, with its
  containment trade-off stated rather than discovered.
- **`timeout-minutes` rises 20 → 30** with the measurement recorded: 13m16s observed on a
  36-file diff is 66% of the current budget, and the `release` job already sits at a
  comparable order. The stale `# NOT yet observed in CI` comment is replaced with the three
  measured runs (2m32s / 9m37s / 13m58s).
- **The merge-latency consequence is written down**: requiring this check takes the PR
  critical path from ~2 minutes to ~14, a **~7×** increase. `quality-gates.md`'s latency
  budget exempts CI from the seconds-order rule, so this violates no non-negotiable — but it
  is the single largest cost of the flip and is currently recorded nowhere.
- **Documentation drift is fixed** (research §10): the job comment arguing from the retracted
  "464 → 6 (99.89%)" figure, the stale timeout comment, `design.md` task 3.3's unrepresentative
  2m31s, and `mutation-gate`'s task 4.1 — whose exit criterion ("split the four
  narrowing-operand lines") is **unreachable as written**: there are seventeen, and `design.md`
  proves splitting cannot work for that mutator family. 4.1 is restated onto this change's
  premise, and task 2.1's "main becomes mutant-clean" framing is corrected.
- **`test/boundaries/mutation-scope.test.ts` is updated with the job.** It pins the command
  shape and the scope alternation today; the verdict step gets its own scenario, or deleting
  the gate would leave the boundary tier green.
- **`report.ts`'s header comment is corrected.** It says *"Never decides pass/fail — Stryker's
  exit code does that."* Under this design that becomes false.

**Explicitly out of scope**, recorded here so neither is mistaken for an omission:

- The **`ignore-unions` ignorer plugin**. It is the right durable fix for the two structural
  equivalent families, and the research says so — but it is a rule-pack decision with its own
  false-negative cost (it would also hide a genuinely wrong `case` grouping), so it gets its
  own change and its own grilling.
- The **two MusicBrainz album-title survivors**. They are a real domain bug — an absent title
  carried as `''` rather than `undefined`, letting punctuation-titled albums (`÷`, `+`, `?`)
  bypass the ambiguity guard — not a mutant to suppress. Waiving them would be the fiction
  `testing.md` forbids.

## Capabilities

### New Capabilities

<!-- none -->

### Modified Capabilities

- `mutation-testing`: the gate's failure scope narrows from changed files to changed lines
  while its reporting scope stays file-wide; the verdict moves off the mutation runner's exit
  code onto a step that owns it; the verdict ships in shadow and fails closed on an absent or
  unmeasured audit.

## Impact

- **Code:** a new verdict module + entrypoint under `scripts/mutation/` with its own tests; a
  changed-hunk parser; `report-model.ts` gains the mutated span's end position;
  `.github/workflows/pipeline.yml` (new step, moved `continue-on-error`, raised timeout,
  rewritten comments); `test/boundaries/mutation-scope.test.ts`; `report.ts`'s header comment.
- **Artifacts:** `openspec/changes/mutation-gate/{tasks,design,specs}` amended where this
  change supersedes their premise (tasks 2.1 and 4.1, the 3.3 timing, and the spec's three
  requirements currently listed under both MODIFIED and ADDED — which fails
  `openspec validate --strict`).
- **Version:** `chore` — CI/tooling and artifacts only, no bump, no release.
- **Dependencies:** none new. Builds on `mutation-gate` (merged, unarchived).
- **Not in this change:** enabling enforcement, and the ruleset's required-check flip. Both
  wait on the shadow measurement clearing the ten-percent bar; both are a follow-up.
- **Risk retired:** the gate stops being conditional on a state that cannot exist, and starts
  measuring whether it can honestly block.
