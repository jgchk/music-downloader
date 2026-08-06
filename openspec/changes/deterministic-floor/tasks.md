# Tasks — deterministic-floor

Sequencing: after `close-enforcement-gaps` merges (shared `eslint.config.js` surface; that
change widens tier coverage this one then hardens). Mechanical commits separated from
judgment commits. Red-first only where a triage uncovers a real defect (then `fix:`).

## 1. Strict typed profile

- [ ] 1.1 Bump the production profile to `strictTypeChecked` + `stylisticTypeChecked`;
      run repo-wide; fix mechanical fallout in its own commit.
- [ ] 1.2 For each rule that fails the repo: fix sites or disable with a one-line
      justification comment (unicorn carve-out pattern); no blanket `warn` downgrades.
- [ ] 1.3 Verify test tiers still run the production profile plus only their documented
      carve-outs (`close-enforcement-gaps` invariant preserved under the new tiers).

## 2. sonarjs admission review

- [ ] 2.1 Add `eslint-plugin-sonarjs` pinned; enable `recommended`; capture the repo-wide
      finding inventory grouped by rule.
- [ ] 2.2 Triage every rule with findings: admit (fix findings, rule stays `error`) or
      reject (disable + justification comment). Record the tally in `design.md` D3.
- [ ] 2.3 Any genuine production defect found: red-first regression test, fix, retitle
      release impact to `fix:`.
- [ ] 2.4 If zero rules admitted: drop the plugin, record the outcome in the tally.

## 3. Constitution

- [ ] 3.1 Write `docs/development/quality-gates.md`: admission contract (<10% effective FP,
      actionable-only, appeasement counts as false), four-rung promotion ladder with
      when-to-stop guidance, waiver-doctrine cross-reference, and the local-gate latency
      budget (`pnpm check` stays seconds-order; minutes-order analysis lives in CI and is
      locally runnable on demand, never in the commit gate).
- [ ] 3.2 Link it from CLAUDE.md's constitution list and from `testing.md`/
      `coding-standards.md` where they touch gate membership.
- [ ] 3.3 Sanity-check the contract text against the actual sonarjs triage experience
      (task 2) and amend before merge — the triage is the contract's first exercise.

## 4. /ship promotion mining

- [ ] 4.1 Add the post-convergence step to the ship skill: scan the cycle's findings for
      recurring (≥2) or purely-mechanical finding classes; file one GitHub issue per
      candidate (`promote: <sketch>`, label `quality-gate`, body = instances + proposed
      ladder rung + admission bar). Create the `quality-gate` label.
- [ ] 4.2 Leave `/retro` untouched; note in the ship skill that promotion mining is
      per-change, retro is per-session.

## 5. Gate

- [ ] 5.1 `pnpm check` green; commit the research doc
      (`docs/research/automated-quality-function.md`) with the change.
- [ ] 5.2 Version decision: `chore` (no bump) unless task 2.3 fired (`fix:` patch bump).
