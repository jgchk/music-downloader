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

## Decisions taken at implementation

**D8 — The boundaries tier reads `eslint.config.js` via `allowJs`** (settling the open question
below). Both were measured: `allowJs: true` on `test/boundaries/tsconfig.json` produced exactly one
error, and fixing it made the diff *negative* — TS inferred the config's real `ConfigArray` type,
which let a hand-rolled `FlatConfigEntry` interface and two `as readonly Record<string, unknown>[]`
casts be deleted. A local `.d.ts` would have had to declare the export as `unknown` (a precise hand
declaration is a second source of truth that drifts from the config it describes, silently — the
exact failure mode this tier exists to prevent) and would have kept those casts. The tier's tsconfig
also claims `eslint.config.js` in `include`, so the config file itself is now linted; it was
previously ignored by `**/*.config.js`.

**D9 — The root project must be named `tsconfig.json`.** The build-tooling config files
(`vitest.config.ts`, `packages/web/*.config.*`, …) belong to no package. A
`tsconfig.config-files.json` typechecks them fine but leaves all seven a *lint parse error*:
eslint's project service discovers projects by walking up for that exact filename. Renaming it to a
root `tsconfig.json` with an explicit `files` list (so it claims nothing else on its way up the
tree) fixed all seven — the service does consult ancestor projects when the nearest one does not
claim the file.

**D10 — Two typecheckers, so two coverage assertions.** `ts.getParsedCommandLineOfConfigFile` never
lists a `.svelte` file (the compiler does not know the extension), so the boundaries tier proves
`.ts` coverage by tsconfig membership and `.svelte` coverage by containment in `svelte-check`'s
project root. Both the tsconfig set and the source set are *discovered*, not listed, so a new tier
or project counts the moment it lands.

**D11 — Deviation from D5 on the `conventional-changelog` typings.** The measurement predicted
missing typings needing a local `.d.ts`; the truth is that those packages ship types and
`conventional-changelog-conventionalcommits@10.2.1` simply declares `createPreset`'s return type as
`{}`. A `.d.ts` cannot repair a return type without a duplicate-identifier conflict, so the fix is a
named local `Preset` interface derived from the *consumers'* signatures plus one documented cast.

**D12 — `unicorn/no-process-exit` gets a named CLI carve-out.** Nine hits, all in real command-line
programs (release tooling, schema generators, contract recorders and drift checkers) where an exit
status *is* the interface — which is what unicorn's own rule text says. The rule stays on
everywhere else, where a bare exit would tear down the process serving both modules and the web UI.

**D14 — Gate cost, measured.** `pnpm check` went from ~22s to ~27s wall (parallel mode), the whole
delta in the lint lane, which now covers ~66 more files; the new `typecheck:tiers` lane runs eight
small projects serially in ~10s and is not the critical path. No lane restructuring warranted.

**D13 — The test-tier carve-out is scoped to test *code*, not `*.test.ts`.** The tiers' helpers,
fixture builders, and recorders are test code by any reading, so the shared `testFiles` glob covers
`test/**`, `packages/*/test/**`, and `packages/web/tests/**` alongside `**/*.test.ts`. Only
`unicorn/name-replacements` was added to the existing carve-outs (59 hits, all identifiers mirroring
wire shapes); scripts' 21 hits were fixed properly, as D5 intended.

## Open Questions

- ~~Whether the boundaries tier imports `eslint.config.js` via `allowJs` or a hand `.d.ts`.~~
  Settled as `allowJs` — see D8.
