# Tasks — close-enforcement-gaps

Red-first where behavior changes (the reset fixes, the FP refactor); mechanical
coverage/cleanup commits separated from hand-fix commits so the diff narrates itself.
Sequencing: after the S-queue drains (S2/S3 touch overlapping test files).

## 1. The Result rule

- [x] 1.1 Add `@ninoseki/eslint-plugin-neverthrow` pinned; `must-use-result` in the production
      profile; test tiers excluded via a commented override naming the ratchet trigger;
      `no-floating-promises` + `checkThenables` as defense-in-depth.
- [x] 1.2 Fix both `reset()` discarded `checkpoints.save`s (red first: save-failure fake proves
      reset reports the failure) — `fix:`, both modules.
- [x] 1.3 Resolve the six logging-helper false positives refactor-first (structural
      consumption); fall back to per-site justified disables only if the refactor contorts the
      helper. Zero-waiver posture preserved if structurally possible.
- [x] 1.4 Fix the third true positive (the facade fixture discard).

## 2. Tier coverage — typecheck

- [x] 2.1 Per-tier tsconfigs (scripts, e2e, boundaries, downloader-contract,
      importer-contract) extending base, wired into `pnpm typecheck`; boundaries' config-import
      question settled (allowJs vs local d.ts).
- [x] 2.2 Hand-fixes: downloader-contract brand construction through real smart constructors /
      schema parses (~13 sites); `conventional-changelog` local typings; additivity tests'
      strict-index narrowing; the two stray TS613x cleanups.

## 3. Tier coverage — lint

- [x] 3.1 Delete the tiers from eslint `ignores`; verify projectService coverage; add the
      `unicorn/name-replacements` test-tier carve-out with rationale beside the existing
      unicorn carve-outs.
- [x] 3.2 Autofix pass per tier (mechanical commits), then hand-fix the remainder (notably the
      `no-unsafe-*` cluster in scripts/downloader-contract and scripts' nine name-replacement
      renames).

## 4. Svelte zones

- [x] 4.1 Zones `files` gains `**/*.svelte`; resolver extensions gain `.svelte`; a red-first
      probe violation proves the rule fires in `<script lang="ts">`, then is removed; the
      ExportMap `.svelte`-blindness limitation documented in the config comment.

## 5. Constitution and gate

- [x] 5.1 `error-handling.md`'s linter sentence updated to name the real rule; the boundaries
      tier asserts the new coverage (a file outside every tsconfig/lint zone is a failure).
- [x] 5.2 Full gate green; `pnpm check` timing sanity-checked; local out-of-process e2e green.

## 6. Review convergence (cycles 1–3)

Findings the pre-PR review roster raised against this change's own diff. The rule this change
adds is only as good as the code it polices, so its own true positives are fixed here rather
than deferred.

- [x] 6.1 **Critical** — `start()`'s `unwrapOr(0)` erased a checkpoint-store fault into "fresh
      consumer at 0" on the live boot path (both modules). Now halts: nothing delivered,
      checkpoint untouched, module readiness `down`. Red-first (the old test *pinned* the
      replay). Design D15; spec delta in `specs/cross-module-delivery/`.
- [x] 6.2 `reset()` returned `Promise<Result<…>>`, invisible to this change's own new rule
      (verified empirically with a probe file). Now `ResultAsync`, as is `pollCatchUp` — the
      one other blind-spot signature with no production caller. Design D16.
- [x] 6.3 `reset()`'s Ok arm over-promised under concurrency; now serialized against the drain
      (red-first: a reset racing an in-flight cycle left the checkpoint ahead of the requested
      position while reporting success).
- [x] 6.4 `reset()`'s cursor half was unpinned — verified the new test kills the mutant that
      moves the cursor before the save lands.
- [x] 6.5 Contract-tier brand forging: `asMbid` casts replaced by real parses/smart
      constructors, so a recording that stops carrying a well-formed id fails the run instead
      of being blessed by a cast.
- [x] 6.6 Boundaries gate-coverage hardening: path-anchored skip matching (basename matching
      was silently excluding production source), tsconfig diagnostics surfaced instead of
      swallowed, and the `svelte-kit sync` race removed.
- [x] 6.7 Release tooling: the `Preset` shape validated at the boundary instead of asserted (a
      dependency key rename silently defaulted the changelog parser), and `anchorVersion`'s
      anchor fix pinned by a test that is red against the pre-fix regex.
- [x] 6.8 Lint-config truthfulness: the two carve-out blocks that named `**/*.test.ts` directly
      now use the shared `testFiles` constant, whose doc comment enumerates the full six-rule
      divergence; design D13 corrected (two rules were added, not one) and D2 amended to record
      the thunk shape actually shipped.
