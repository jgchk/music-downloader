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
- [ ] 5.2 Full gate green; `pnpm check` timing sanity-checked; local out-of-process e2e green.
