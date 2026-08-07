# Tasks — deterministic-floor

Sequencing: after `close-enforcement-gaps` merges (shared `eslint.config.js` surface; that
change widens tier coverage this one then hardens). Mechanical commits separated from
judgment commits. Red-first only where a triage uncovers a real defect (then `fix:`).

## 1. Strict typed profile

- [x] 1.1 Bump the production profile to `strictTypeChecked` + `stylisticTypeChecked`;
      run repo-wide; fix mechanical fallout in its own commit.
- [x] 1.2 For each rule that fails the repo: fix sites or disable with a one-line
      justification comment (unicorn carve-out pattern); no blanket `warn` downgrades.
- [x] 1.3 Verify test tiers still run the production profile plus only their documented
      carve-outs (`close-enforcement-gaps` invariant preserved under the new tiers).

## 2. sonarjs admission review

- [x] 2.1 Add `eslint-plugin-sonarjs` pinned; enable `recommended`; capture the repo-wide
      finding inventory grouped by rule.
- [x] 2.2 Triage every rule with findings: admit (fix findings, rule stays `error`) or
      reject (disable + justification comment). Record the tally in `design.md` D3.
- [x] 2.3 Any genuine production defect found: red-first regression test, fix, retitle
      release impact to `fix:`. **Outcome for sonarjs: none** — all 18 rules with findings were
      triaged and the four likeliest defect candidates traced to ground; every one is a false
      positive (design.md D3). **But the STRICT TIER did surface one**, via
      `no-unnecessary-condition` on the login route — see the "Real defect" note in design.md D3.
      It is fixed in the review commit. Release-type consequence is a decision left to the
      shipper (see 5.2).
- [x] 2.4 If zero rules admitted: drop the plugin, record the outcome in the tally.
      **Did not fire:** one rule was admitted, so the dependency stays — but only that rule is
      enabled, not `recommended` minus the rejections (design.md D3, with the latency evidence).

## 3. Constitution

- [x] 3.1 Write `docs/development/quality-gates.md`: admission contract (<10% effective FP,
      actionable-only, appeasement counts as false), four-rung promotion ladder with
      when-to-stop guidance, waiver-doctrine cross-reference, and the local-gate latency
      budget (`pnpm check` stays seconds-order; minutes-order analysis lives in CI and is
      locally runnable on demand, never in the commit gate).
- [x] 3.2 Link it from CLAUDE.md's constitution list and from `testing.md`/
      `coding-standards.md` where they touch gate membership.
- [x] 3.3 Sanity-check the contract text against the actual sonarjs triage experience
      (task 2) and amend before merge — the triage is the contract's first exercise.

## 4. /ship promotion mining

- [x] 4.1 Add the post-convergence step to the ship skill: scan the cycle's findings for
      recurring (≥2) or purely-mechanical finding classes; file one GitHub issue per
      candidate (`promote: <sketch>`, label `quality-gate`, body = instances + proposed
      ladder rung + admission bar). Create the `quality-gate` label.
- [x] 4.2 Leave `/retro` untouched; note in the ship skill that promotion mining is
      per-change, retro is per-session.

## 5. Gate

- [x] 5.1 `pnpm check` green; commit the research doc
      (`docs/research/automated-quality-function.md`) with the change. The research doc was already
      committed on the base branch — verified present at the base revision, not re-added.
- [x] 5.2 Version decision: **RESOLVED at ship time — this ships as a `fix`, patch bump to
      3.17.5.** The sonarjs triage found no defect, but the strict tier did (login route,
      design.md D3), and that fix originally rode in the `chore(review):` commit, where it would
      have reached production with no changelog line.

      It was **split into its own `fix(web):` commit** rather than retitling the whole review
      commit, so the changelog names the defect and nothing else: the review commit carries a dozen
      unrelated findings, and a `fix:` subject covering all of them would describe the release
      worse than it describes the diff.

      The bar this clears is deliberate, not reflexive. It is a real behavioural defect (not a
      refactor), reachable by anyone with a URL on the one route served **without a session**, and
      it broke a declared type — `?error=toString` handed the page a Function where `string` was
      declared. An operator reading the changelog to decide whether to take an upgrade needs to see
      that. Everything else in this change is tooling and docs, so the `chore`/`docs`/`style`
      commits stay as they are and contribute no release semantics; the `fix` alone drives the bump.

      This also restores the sequencing note at the top of this file ("Red-first only where a triage
      uncovers a real defect (then `fix:`)") to being true of what shipped.
