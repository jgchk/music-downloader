# Design — deterministic-floor

## Context

`docs/research/automated-quality-function.md` (2026-08-05) surveyed the literature on
automated quality functions and ranked this repo's next moves. Two findings drive this
change. (1) Deployment model dominates analyzer power (Meta: identical analyzer, ~0% fix
rate nightly-batch vs >70% at diff time; Google Tricorder: <10% effective-FP admission bar,
where ignored findings count as false) — and this repo's every-commit gate is already the
attested-good shape, so the remaining wins are stronger rules in the same seat, not new
seats. (2) In an unattended loop the death-spiral is worse than at Google: an agent that
cannot ignore a noisy check will *appease* it (test fiction, gratuitous waivers), so the
admission bar must be constitutional before more checks join the gate — the mutation gate
(`mutation-gate` change) is next in line and inherits this contract.

The grilled decisions this design implements: strict + stylistic typed profiles together;
sonarjs via one-shot admission review (no server, no time-boxed or warn-level trial);
`quality-gates.md` as a new constitutional doc; `/ship` mines promotion candidates into
GitHub issues; `/retro` untouched.

## Goals / Non-Goals

**Goals**

- Production lint profile at the strictest typed tier, fallout fixed, carve-outs justified.
- `eslint-plugin-sonarjs` admitted rule-by-rule under the admission contract; tally recorded
  here (see "Admission tally", filled during implementation).
- `docs/development/quality-gates.md`: admission contract + promotion ladder, linked from
  CLAUDE.md.
- `/ship` files promotion-candidate GitHub issues after review convergence.

**Non-Goals**

- No SonarQube server, Semgrep/Opengrep, or CodeQL adoption (Opengrep is a ladder rung,
  adopted when first needed). No new review agents. No mutation testing or PBT (sibling
  changes). Nothing from `close-enforcement-gaps` scope.

## Decisions

### D1 — Both strict tiers at once, carve-outs over downgrades

`strictTypeChecked` and `stylisticTypeChecked` land in one pass: same surface, same fallout
run, and the stylistic tier's churn is exactly the kind of mechanical work the factory
absorbs cheaply. A rule that fails the repo is disabled at the config site with a one-line
justification (the unicorn carve-out pattern). Blanket `warn` downgrades are forbidden — a
warning nobody blocks on is the Meta nightly-batch shape, attested-dead.

### D2 — One-shot admission review for sonarjs (rejected: time-boxed trial, warn-level trial)

The `recommended` set is enabled, run repo-wide, and every finding triaged rule-by-rule:

- **admit** — findings include ≥1 genuine defect or a real clarity win; rule stays at
  `error`, findings fixed in this change.
- **reject** — findings are all noise, or duplicate typed-eslint/unicorn coverage; rule
  disabled with a one-line justification comment.

A time-boxed trial was rejected (nobody watches between cycles; N cycles of appeasement is
the exact failure mode), warn-level was rejected (non-blocking output has no consumer here).
This triage is deliberately the first execution of the quality-gates admission contract —
if the contract text doesn't survive contact with 300-odd sonarjs findings, it gets fixed
here, before the mutation gate leans on it.

If a triage uncovers a genuine production defect, its fix is red-first (failing test, then
fix) and retitles the change's release impact to `fix:`.

### D3 — Admission tally lives in this design doc

Filled in during implementation, one line per rule with findings:
`rule — admitted/rejected — count — reason`. This is the evidence the spec delta's
"admitted, not accumulated" requirement points at.

### D4 — `quality-gates.md` is constitutional, not OpenSpec

The contract governs *how we build* (what earns gate membership, how English rules become
machine rules) — `docs/development/` altitude, no domain specifics. Contents: the admission
contract (<10% effective FP, actionable-only, appeasement counts against), the four-rung
promotion ladder (`no-restricted-syntax` → local ESLint rule → Opengrep dataflow rule →
type-level unrepresentability, each rung named with when-to-stop guidance), and the waiver
doctrine cross-reference (justified like an `any`). The spec delta in this change pins the
gate-membership requirement; the doc carries the mechanics.

### D5 — `/ship` promotion mining: post-convergence, issues not PR bodies

After review convergence (zero findings), the ship flow adds one step: scan the cycle's
applied findings for (a) any finding class that appeared ≥2 times across cycles, (b) any
finding whose fix was purely mechanical. Each candidate becomes one GitHub issue titled
`promote: <rule sketch>`, labeled `quality-gate`, body naming the finding instances, the
proposed ladder rung, and the admission-contract bar it must clear. Issues are the durable
channel — the factory must not depend on a human reading PR bodies. `/retro` remains
standalone (session-level process retro is a different altitude than per-change finding
mining).

## Risks / Trade-offs

- **Strict-tier fallout volume is unknown until run.** Mitigation: mechanical-fix commits
  separated from judgment commits; carve-out escape hatch is cheap and documented.
- **Sonarjs may admit ~nothing.** That is a valid outcome, recorded in the tally — the
  plugin then costs one dependency and a config block for a handful of live rules; if
  *zero* rules are admitted the plugin is dropped entirely and the tally records why.
- **Promotion issues could accumulate unread.** Accepted for now: the queue is visible, and
  `/retro` naturally reviews open `quality-gate` issues; a staleness policy can follow.
- **Two changes editing `eslint.config.js`** — sequencing after `close-enforcement-gaps` is
  mandatory, not advisory (see proposal Impact).

## Migration Plan

Single change, three commit lanes: (1) profile bump + fallout (mechanical), (2) sonarjs +
triage fixes (+ any red-first `fix:`), (3) constitution doc + CLAUDE.md link + `/ship` step.
No runtime migration; revert is config-local per lane.

## Open Questions

- None blocking. The admission tally and the final carve-out list are implementation
  outputs, recorded here when known.
