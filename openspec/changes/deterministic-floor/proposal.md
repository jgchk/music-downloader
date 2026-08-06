# Proposal: deterministic-floor

## Why

The automated-quality-function research (`docs/research/automated-quality-function.md`,
2026-08-05) reached one cross-cutting verdict: in an unattended factory the deterministic
layers must be as strong as the ecosystem allows, because the LLM judgment layer above them is
the unproven part — and a decade of Google/Meta production data says noisy checks in an
unattended loop invite *appeasement*, not just neglect. Two gaps follow directly. First, the
production lint profile runs `recommendedTypeChecked` (`eslint.config.js`), not the strictest
available typed tier — free signal left on the table. Second, the repo has no stated rule for
what earns a place in the gate: rule packs, agents, and checks accumulate by enthusiasm, with
nothing preventing a noisy check from teaching the `/ship` loop to appease it. The research
also resolved the SonarQube question: skip the server, trial the rules — SonarQube's entire TS
engine ships as `eslint-plugin-sonarjs` and runs inside `pnpm check`.

## What Changes

- **The typed lint profile becomes the strictest tier.** `recommendedTypeChecked` →
  `strictTypeChecked` + `stylisticTypeChecked` across the production profile, with repo-wide
  fallout fixed in this change. Rules that fail the repo (churn without defect value) are
  disabled per-rule with a one-line justification comment — the documented unicorn-carve-out
  pattern, not blanket severity downgrades.
- **`eslint-plugin-sonarjs` enters through a one-shot admission review.** Enable the
  `recommended` set, run repo-wide, and triage every finding rule-by-rule: a rule stays if its
  findings include at least one genuine defect or real clarity win; a rule whose findings are
  all noise or duplicate existing coverage is disabled with a justification comment. The
  admission tally (rules admitted / rejected, with reasons) is recorded in `design.md`. No
  SonarQube server — the gate has no human dashboard consumer.
- **The admission contract becomes constitution.** New `docs/development/quality-gates.md`:
  a check is admitted to the gate only if it is actionable with a <10% *effective*
  false-positive rate, where any finding the loop ignores, waives without cause, or appeases
  counts as false; plus the four-rung promotion ladder for collapsing English rules into
  machine rules (`no-restricted-syntax` → local ESLint rule → Opengrep dataflow rule →
  type-level unrepresentability). Linked from CLAUDE.md's constitution list. The sonarjs
  admission review above is the contract's first exercise.
- **`/ship` mines review findings for promotion candidates.** After review convergence, the
  ship skill scans the cycle's findings for anything recurring or mechanizable and files each
  candidate as a GitHub issue (durable channel — the factory must not depend on a human
  reading PR bodies). `/retro` stays a standalone, unchanged skill.
- **The research doc ships with the change** (`docs/research/automated-quality-function.md`),
  as the cited evidence base.
- **Non-goals:** no SonarQube server, no Semgrep/CodeQL/Opengrep adoption now (Opengrep is
  named only as the ladder's dataflow rung, adopted when a promotion first needs it); no
  re-doing the `close-enforcement-gaps` scope (Result rule, tier gate coverage, Svelte zones —
  that drafted change owns the result-lint backlog); no new review agents.

## Capabilities

### New Capabilities

<!-- none -->

### Modified Capabilities

- `module-architecture`: the production lint profile's strictness becomes a stated
  requirement — strictest typed tier plus admitted rule packs only, every carve-out justified
  in config, and gate membership governed by the admission contract.

## Impact

- **Code:** `eslint.config.js` (profile bump, sonarjs plugin, per-rule carve-outs), repo-wide
  mechanical fallout fixes, `docs/development/quality-gates.md` (new), CLAUDE.md constitution
  link, `.claude/skills/ship` (promotion-mining step), the research doc.
- **Version:** `chore` — no runtime behavior change, no bump; if the sonarjs triage uncovers a
  genuine production defect, its fix ships here as `fix:` and forces a patch bump.
- **Dependencies:** sequenced **after `close-enforcement-gaps`** — both edit the eslint
  config and that change moves tiers into the gates this change then hardens; landing this
  first would double the fallout pass.
- **Risk retired:** the unattended loop gains a stated admission bar before the mutation gate
  and any future checks join; profile drift ("strict was the plan, recommended is the state")
  is closed with evidence in hand.
