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

## 7. Review convergence (cycle 4 — the closing pass)

The list carried into this cycle, closed. Each guard test below was proven red against the
unfixed code (or against the plausible wrong fix) before being trusted.

- [x] 7.1 **Critical** — the `must-use-result` blind-spot comment was wrong about the rule it
      documents: it claimed `Result.combine` arguments still flag (the rule has a dedicated
      acceptance path for them) and presented the rule's own message as the acceptance set, which
      really has six positions. Rewritten from the pinned plugin source.
- [x] 7.2 **Critical** — the rule itself was unguarded: deleting it from the config cannot
      produce a violation, so every lane stayed green. `test/boundaries/rule-profile.test.ts`
      resolves the config per tier and fails on the deletion (verified: deleting only the
      production occurrence turns four scenarios red).
- [x] 7.3 The `testFiles` "exactly six rules" comment was wrong in both directions —
      `no-non-null-assertion` was dead config (`recommendedTypeChecked` never enables it), and
      the CLI entrypoints swept in by the same globs diverge by a different set. Dead line
      removed, both sets now derived from the resolved config and compared to the comment.
- [x] 7.4 The downloader subscription lacked the importer's permanent-render-defect halt, so a
      render defect in the verdict mapping would wedge `seam:verdicts` forever while `/health`
      answered 200. Halt added, and the standing-hold log now names the failure on both sides.
      Design D18; spec delta extended.
- [x] 7.5 The seam-error kind crosses the ACL as a bare string with nothing pinning the two
      sides together. Each module declares its kinds in `seam-contract.json`; both contract tiers
      pin both roles. Proven by mutation in both directions.
- [x] 7.6 `stop()` did not await the in-flight drain, so a cycle could resume after
      `database.close()`. Now async and awaited by both runtimes and the web composition root.
      Proven against the plausible wrong fix (an async `stop()` that skips the await).
- [x] 7.7 Stale decisions corrected: D12 named release tooling as a CLI carve-out member (it is
      deliberately excluded, having zero `process.exit` calls) and fixed a hit count nothing
      checks; D10 claimed nothing was hand-listed when the guard's own floor and the web lane's
      reach both are; D16 called the reset serialization a boolean gate when it is a counter and
      a queue. D17 records the counter/queue/`fromPromise` reasoning.
- [x] 7.8 The spec delta claimed readiness reports down "naming the fault", which the
      `{ status }` shape cannot deliver. The scenario now says what is true: readiness reports
      down and the fault is named in a structured log line.
- [x] 7.9 The `.svelte` `must-use-result` blind spot documented — the component block is not
      type-aware (a policy choice, not a parser limit) and the rule needs the type checker, so a
      discarded Result in a `<script lang="ts">` is invisible to lint.

## 8. Verification pass (cycle 4)

Four reviewers scoped to this cycle's own fixes: comment accuracy, test quality,
errors-as-values, bounded contexts. Two Criticals, both closed; every fix below was proven
against the mutant that motivated it.

- [x] 8.1 **Critical** — the composition-level ordering (drain fully before `database.close()`)
      had no test: reordering the close above the await, and dropping the await, both left the
      whole suite green. Both runtimes now park a drain inside a gated feed read, stop, and read
      the checkpoint back from the reopened file; both mutants fail it.
- [x] 8.2 **Critical** — `rule-profile.test.ts` sampled four production paths, so a carve-out
      over `src/adapters` + `src/domain` disabled the rule across both layers with every
      boundaries scenario green. The suite now also reads the config array and pins every block
      mentioning the rule; samples widened per layer and asserted to exist.
- [x] 8.3 Divergence was severity-only, so stripping `checkThenables` for all test code read as
      no divergence. Comparison is now level plus options.
- [x] 8.4 The halt branch's early `return` was unpinned — deleting it logged a contradictory
      transient "holding checkpoint" line after the permanent one. Both sides now assert the
      halt logs exactly once, and what it says.
- [x] 8.5 Comment corrections in the rewrite itself: acceptance position 2 had the quantifier
      backwards (the rule accepts on at least ONE handled reference — a single `isOk()` licenses
      every other bare hand-off), a seventh acceptance path was missing (any TypeScript-syntax
      parent short-circuits the rule, so a cast or `!` disarms it), and the `testFiles` comment
      wrongly described the `scripts`-tree CLI entrypoints as swept in and re-armed.
- [x] 8.6 Twin/doc accuracy: the importer said "every verdict behind it" on a subscription that
      tails fulfilments; both `stop()` docstrings overstated how immediately the caller closes the
      handle; the flush helper was named for the opposite of what it does.
