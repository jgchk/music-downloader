# Design — close-enforcement-gaps

## Context

See proposal.md — Why. Evidence: `docs/research/result-lint-and-tier-enforcement.md` (fork
verdicts verified empirically on the repo's exact pins) and the measurement pass (per-tier
violation counts, top rules/codes, representative errors — reproduced in the research doc's
companion table). Grill decisions 2026-08-05: all three judgment calls adopted as recommended.

## Goals / Non-Goals

**Goals:** the two constitutional claims made true; zero-waiver posture preserved where
structurally possible; every future file born covered.

**Non-Goals:** eslint/TS upgrades; test-tier Result ratchet; dependency-cruiser; solving
ExportMap's Svelte blindness (documented limitation).

## Decisions

**D1 — Rule choice.** `@ninoseki/eslint-plugin-neverthrow@0.2.0` `must-use-result` in the
production profile: the only maintained implementation, developed against this exact stack;
trial-verified (9 findings: 3 true, 6 one-idiom FPs). The original eslint-plugin-neverthrow
(dead since 2021, still named in neverthrow's README) is rejected; `no-floating-promises` +
`checkThenables` added as defense-in-depth (catches un-awaited `ResultAsync`, cannot catch the
awaited-but-discarded shape that is the live bug).

**D2 — FP handling, refactor-first.** The best-effort logging helper takes the Result today;
preferred fix: split the helper so callers pass the already-unwrapped error (consumption
becomes visible to the rule at the call site's `match`/`isErr`), keeping the repo at zero
waivers. Fallback (if the split contorts the API): per-site disables, each with a one-line
justification, per the waiver doctrine. Decided at implementation by which diff reads better —
both shapes are pre-approved.

**D3 — The reset() fixes.** Both catch-up subscriptions' `reset()` discard `checkpoints.save`'s
Result; fix propagates the failure as the modeled outcome the caller already expects
(red-first: a save-failure fake proves reset reports it). `fix:`-class, the change's version
driver.

**D4 — Tier tsconfigs, the tRPC shape.** One small `tsconfig.json` per tier extending
`tsconfig.base.json` (scripts needs `allowImportingTsExtensions`; boundaries needs `allowJs`
or a local d.ts for importing `eslint.config.js`), all wired into `pnpm typecheck` serially;
no project-references build graph (nothing builds these tiers). eslint: delete the tiers from
`ignores`; projectService picks them up. `allowDefaultProject` rejected (8-file cap, no
globs).

**D5 — Known hand-work, pre-scoped from measurement.** Downloader-contract brand construction
(~13 sites) goes through the domain's real smart constructors or schema parses — fixtures
proving brands structurally was the defect, not the checker; `conventional-changelog` typings
via a local `.d.ts` for the two untyped imports; the additivity tests' TS2532s fixed with
proper narrowing (not `!`). The `unicorn/name-replacements` carve-out lands in the shared test
override with rationale; scripts' nine hits are fixed.

**D6 — Svelte zones.** Zones block `files` gains `'**/*.svelte'`; node-resolver extensions
gain `.svelte` — verified firing correctly inside `<script lang="ts">` on this toolchain.
Current violations: zero; the edit is prevention. ExportMap-family blindness to `.svelte`
edges documented in the config comment.

**D7 — Sequencing.** Ships after the S-queue drains (S2/S3 touch contract and e2e files this
change also touches); the mechanical cleanup then rebases trivially. Autofix passes run
per-tier with `projectService` (the measurement's `--fix-dry-run` crash was an artifact of the
scratch project-array setup, noted so nobody rediscovers it).

## Risks / Trade-offs

- **[The plugin is a small-community fork]** → Pinned exactly; its rule is ~200 lines and the
  research archived its repo state; worst case we vendor the rule (the trigger recorded in the
  config comment).
- **[Newly-covered tiers rot the gate's speed]** → 57 files across five tiers; measured lint
  runtime is seconds; typecheck is serial small configs.
- **[Autofix churn in review]** → Mechanical commits separated from hand-fix commits so the
  diff narrates itself.

## Migration Plan

Single change, `fix:` bump (D3). No deploy sequencing beyond D7. Rollback is reverting the
config + fixes together (the gates and the code they cover move as one).

## Open Questions

- Whether the boundaries tier imports `eslint.config.js` via `allowJs` or a hand `.d.ts` —
  whichever produces the smaller honest diff at implementation.
