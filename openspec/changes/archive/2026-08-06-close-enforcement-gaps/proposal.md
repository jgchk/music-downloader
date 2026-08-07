# Proposal: close-enforcement-gaps

## Why

The whole-project review sweep (2026-08-05) found two constitutional enforcement claims that are
not actually enforced: `docs/development/error-handling.md` says the linter flags an unhandled
`Result` (no such rule exists anywhere — and the maintained-fork trial run promptly found three
real discarded Results in production `src`, including both subscriptions' `reset()` paths
silently dropping a failed `checkpoints.save`, so an operator replay can report success while
saving nothing), and "every commit passes lint and typecheck" excludes `scripts/**` and four
test tiers from both gates — including `test/boundaries/`, the tier that pins the architecture
rules. The evidence base is `docs/research/result-lint-and-tier-enforcement.md` (mechanism
verified empirically against this repo's exact pins) plus a measurement pass over every exempt
tier: 57 TS files, 29 typecheck errors, 222 lint findings (~48% auto-fixable) — big-bang
feasible everywhere, no ratchet warranted.

## What Changes

- **The Result rule exists.** `@ninoseki/eslint-plugin-neverthrow` (`must-use-result`) joins
  the production profile — the maintained fork, verified working on this repo's eslint 10.7 /
  ts-eslint 8.65 / TS 6.0 / neverthrow 8.2 pins; no TS-upgrade pressure. Its three true
  positives are fixed in this change (both `reset()` discarded `checkpoints.save`s — a `fix:`
  — plus the fixture). The six false positives (Results passed into a best-effort logging
  helper, which *is* consumption) are resolved refactor-first: make the helper's consumption
  structural if a small signature change suffices, otherwise per-site justified disables under
  the waivers-justified-like-an-`any` doctrine. The rule stays **off in test tiers** via a
  commented override (336 findings there; ratchet trigger recorded). `no-floating-promises`
  gains `checkThenables` as defense-in-depth only.
- **The rule's own blind spot is closed where it hid the live defect.** Review found that a
  `Promise<Result<…>>` return type is invisible to `must-use-result` (only `Result`/`ResultAsync`
  are seen), and that `start()` — the *live-path* twin of `reset()`, on every boot — collapsed a
  faulted checkpoint read into `unwrapOr(0)`: a checkpoint-store fault booted silently as a fresh
  consumer, replayed the producer's entire feed, and still reported readiness `up`. Both
  subscriptions now halt on an unreadable checkpoint (nothing delivered, checkpoint untouched,
  module readiness `down`), `reset()` and `pollCatchUp` return `ResultAsync` so the new rule can
  see them, and `reset()` is serialized against the drain so its success arm cannot be falsified
  by a concurrent advance. Design D15/D16.
- **Every first-party tier enters both gates.** Small per-tier tsconfigs extending
  `tsconfig.base.json` (the low-ceremony attested shape), wired into `pnpm typecheck`; the
  tiers deleted from eslint `ignores` so projectService covers them with the production
  profile. Big-bang per the measurements; the known hand-work is bounded (branded-type
  construction in downloader-contract fixtures ~13 sites, `conventional-changelog` typings in
  one scripts file, ~10 strict-index fixes in the additivity tests). Test tiers get the full
  profile plus short named carve-outs: `unicorn/name-replacements` carved out for test tiers
  (churny identifier renames; documented like the existing unicorn carve-outs) while
  `scripts/` fixes its nine properly.
- **The Svelte dependency-zone gap closes** with the verified one-edit config change (zones
  `files` gains `**/*.svelte` + resolver extension) — currently zero violations, now enforced
  so it stays that way.
- **The constitution's text becomes true**: `error-handling.md`'s linter claim matches a real
  rule; the ExportMap/Svelte-edges limitation (import rules that silently skip `.svelte`
  graphs) is documented rather than discovered.
- **Non-goals:** no eslint/TS version changes; no test-tier Result ratchet (trigger recorded);
  no dependency-cruiser adoption (documented as the tool if component-graph cycles ever
  matter); no rule-profile redesign beyond the named carve-outs.

## Capabilities

### New Capabilities

<!-- none -->

### Modified Capabilities

- `module-architecture`: the lint/typecheck gates' coverage becomes a stated requirement —
  every first-party source tier inside both gates, and a discarded `Result` is a build break.
- `cross-module-delivery`: a subscription whose durable checkpoint cannot be read halts and
  reports its module down rather than inferring position 0, and a checkpoint reset is serialized
  against delivery so a successful reset means the durable checkpoint really holds the requested
  position.

## Impact

- **Code:** eslint config (rule, overrides, zones, ignores), per-tier tsconfigs +
  `pnpm typecheck` wiring, the two `reset()` fixes and the two `start()` boot-fault fixes
  (`fix:`, both modules' catch-up subscriptions) with red-first regression tests, mechanical
  violation cleanup across the five tiers, the logging-helper thunk refactor.
- **Version:** `fix:` patch bump (the reset and boot-fault defects are production behavior).
- **Dependencies:** none on other drafted changes; S-queue batches touch some of the same test
  files, so this ships after the S-queue drains to keep rebases trivial.
- **Risk retired:** both review-sweep enforcement Importants; the silent-success operator
  replay defect; future contract/e2e/scripts code is born inside the gates.
