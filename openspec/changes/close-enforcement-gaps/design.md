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
both shapes are pre-approved. *Taken at implementation:* a third shape neither option anticipated,
and the best of the three — the helper takes the write as a **thunk** (`() => ResultAsync<…>`)
rather than an already-started `ResultAsync`. Handing a live Result to a callee is invisible to the
rule at the call site *and* at the helper, which is why the six findings looked like false
positives; with a thunk the helper visibly runs and consumes it, so the consumption is structural
and no waiver is needed. Zero waivers preserved (commit `640025d2`, the two slskd best-effort ledger
writes).

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
project root. The tsconfig set and the source set are *discovered* by a filesystem walk, so a new
tier or project counts the moment it lands.

*Corrected in cycle 4:* this decision used to end "discovered, not listed", which read as though
nothing here is hand-maintained. Two lists are, and both are load-bearing. `REQUIRED_TIERS` is a
deliberate hand-written floor: every coverage scenario is `expect(<filtered list>).toEqual([])`, so
a walk that discovered *nothing* would pass all of them — the floor turns an empty or truncated
discovery into a failure. `WEB_LANE_REACH`/`WEB_LANE_EXCLUSIONS` are declared rather than parsed at
coverage time, because reading the project `svelte-kit sync` generates would make this lane's
verdict depend on whether the `web` lane had run yet; a separate scenario re-derives both from that
generated config *whenever it is on disk* and fails on drift, with absence skipping rather than
failing. So: discovery is discovered, the guard's own floor and the web lane's reach are declared
and cross-checked.

**D11 — Deviation from D5 on the `conventional-changelog` typings.** The measurement predicted
missing typings needing a local `.d.ts`; the truth is that those packages ship types and
`conventional-changelog-conventionalcommits@10.2.1` simply declares `createPreset`'s return type as
`{}`. A `.d.ts` cannot repair a return type without a duplicate-identifier conflict, so the fix is a
named local `Preset` interface derived from the *consumers'* signatures plus one documented cast.

**D12 — `unicorn/no-process-exit` gets a named CLI carve-out.** Every hit is in a real command-line
program — the two event-schema generators and the contract recorders/drift checkers — where an exit
status *is* the interface, which is what unicorn's own rule text says. The rule stays on everywhere
else, where a bare exit would tear down the process serving both modules and the web UI.

*Corrected in cycle 4:* this decision originally listed "release tooling" among the carve-out's
members and fixed the count at nine. Neither held. `scripts/**` is deliberately **outside**
`cliEntrypoints`: the release tier has zero `process.exit` calls — it uses the better
`process.exitCode` idiom, which the rule does not flag — so listing it would have disabled the rule
over ~14 files (six of them unit suites) that never needed it. The config comment said exactly
that, and this decision contradicted it. The hit count is left unstated rather than re-pinned: it
is a number that moves with every recorder added, and nothing checks it.

**D14 — Gate cost, measured.** `pnpm check` went from ~22s to ~27s wall (parallel mode), the whole
delta in the lint lane, which now covers ~66 more files; the new `typecheck:tiers` lane runs eight
small projects serially in ~10s and is not the critical path. No lane restructuring warranted.

**D13 — The test-tier carve-out is scoped to test *code*, not `*.test.ts`.** The tiers' helpers,
fixture builders, and recorders are test code by any reading, so the shared `testFiles` glob covers
`test/**`, `packages/*/test/**`, and `packages/web/tests/**` alongside `**/*.test.ts`. Two rules
were added to the pre-existing carve-outs: `unicorn/name-replacements` (59 hits, all identifiers
mirroring wire shapes) and `neverthrow/must-use-result` (per the proposal's test-tier exclusion,
re-armed for the CLI entrypoints those globs sweep in — see D12's block). Scripts' 21
name-replacement hits were fixed properly, as D5 intended. Cycle 3 also re-pointed the two
carve-out blocks that still named `**/*.test.ts` directly at the shared `testFiles` constant: the
tiers' helpers are test code by the same reading, and a block naming its own glob is exactly the
drift the constant exists to prevent. The full divergence is now six named rules, enumerated in the
constant's doc comment so it stays checkable.

**D15 — The boot-time checkpoint fault halts the subscription; it does not refuse the boot, and it
never guesses 0.** Review cycle 3 found `start()`'s `unwrapOr(0)` asserting a durable fact it does
not know: a faulted checkpoint read booted as "fresh consumer at 0", replaying the producer's whole
feed while readiness still reported `up` (the web runtime's `try/catch` only catches throws, and
nothing threw). This is the live-path twin of the `reset()` defect D3 fixed, so it is fixed here —
shipping the "never ignore a Result" rule while its own charter's live-path instance stayed broken
would be the change failing its thesis.

Three policies were weighed. *Guess 0* (the status quo) is rejected outright: it manufactures a
durable fact. *Refuse to boot* matches the seam-watermark precedent (v3.17.2 refuses boot on a
rebuild failure) but is disproportionate here — the composed monolith boots both modules and the web
UI in one process, so a single subscription's store fault would crash-loop the container and take
away the very UI an operator would diagnose it from; the module's own `schedulePoll` comment already
names that blast radius as the thing to avoid. *Halt and report down* is chosen: the subscription
sets the same `halted` flag a poison event sets, delivers nothing, leaves the durable checkpoint
untouched, and surfaces through the readiness signal each module already exposes (`/health` renders
a module's `down` as `degraded`, naming it). It fails safe on both axes the review cared about — no
replay, no false `up` — while confining the blast radius to the seam that actually broke. Wakeup and
interval wiring still registers, so an operator `reset` to a chosen position resumes delivery on a
recovered store without a restart.

Rejected refinement: making the load *self-healing* by retrying it on each fallback poll (a
`cursor: number | undefined` "position unknown" state). It is strictly nicer for a fault that clears
on its own, but the realistic faults here — a corrupt or unreadable module-owned SQLite file — are
persistent, and it buys that narrow case with new state in the class whose whole job is to be
obviously correct under crashes. Recorded as the follow-up if a transient case is ever observed.

**D16 — `reset()` returns `ResultAsync`, and is serialized against the drain.** Two defects behind
one signature. (a) `Promise<Result<…>>` is invisible to `must-use-result` — verified empirically on
this repo's pins: in one probe file the discarded `ResultAsync` call was flagged and the discarded
`Promise<Result>` call was not — so the rule this change exists to add could not police the very
method D3 fixed. `reset()` now returns `ResultAsync`, and so does `pollCatchUp`, the one other
production signature with the blind spot and no production caller (cheap, no call sites to churn).
The nine remaining `Promise<Result>` production signatures are left as a follow-up rather than
sprawling: the two runtime factories are long `async` boot functions, and `SeamFeed.read` /
`OutboundFeed.read` / `ConsumeHandler` are a *structural* port whose shape is mirrored by fakes
across four test tiers. (b) The Ok arm over-promised under concurrency: unserialized, a poll's
`advance` could land just behind the reset's save, leaving the durable checkpoint ahead of
`toGlobalSeq` while `reset` reported the replay armed. Polls are now dropped while a reset is in
flight, and the reset awaits the in-flight cycle out; the drain's coalescing semantics are untouched
(a dropped tick is re-fired by the interval). *Corrected in cycle 4:* (b) above described the
mechanism as a `resetting` **gate**. It is a counter and a queue, and the difference is the whole
point — see D17.

**D17 — Why the reset serialization is a counter and a queue, not a boolean, and why
`fromPromise`.** Three mechanism choices in `reset()` that each look like an over-complication
until the alternative is written out.

*A counter (`resets`), not a boolean `resetting`.* With a boolean, two overlapping resets both set
it and whichever finished FIRST cleared it — re-admitting the drain while the second reset's save
was still in flight. That is the same falsified "replay armed" Ok the serialization exists to
prevent, merely narrowed to the concurrent-reset case. A counter is only released when the last
reset leaves.

*A queue (`resetQueue`), not just the counter.* The counter keeps the *drain* out; it does not order
the resets against each other. Two resets to different positions would otherwise race their saves
and the loser's Ok would describe a checkpoint the winner had already overwritten. Each reset awaits
the previous one's settled promise, then the in-flight drain, then saves.

*`ResultAsync.fromPromise`, not `new ResultAsync`.* The constructor does not catch: a checkpoint
store that *rejects* rather than answering with a Result would escape the declared error channel
entirely and surface as an unhandled rejection — in the composed monolith, on the one process
serving both modules and the web UI. `fromPromise` converts it into the modeled `InfraError` the
signature already promises. The same reasoning drives the `settled()` barrier: a drain's rejection
stays the awaiting `poll` caller's to handle, and the barrier copy swallows it only so that the
barrier itself can never become a second unhandled rejection.

**D18 — The two subscriptions are one behaviour, and neither may write after `stop()`.** Cycle 4
found the twins had drifted. (a) The importer halted on a permanent `RenderError` from the feed;
the downloader folded it into the transient hold path, so a render defect in the importer's verdict
mapping would wedge `seam:verdicts` on one position forever — re-read every five seconds, never
delivered, never skipped — while `/health` answered 200, because a module reports `down` only when
its subscription halts. This is the same class as the boot-fault Critical in D15 and gets the same
policy: halt, hold the checkpoint, report `down`. (b) `stop()` detached the wakeup listener and the
fallback timer and returned. That cancels the *next* cycle, not the one already draining — and both
runtimes close the event-store handle on the following line, so an in-flight cycle went on reading
the feed and saving checkpoints against a closed database, which is the exact error loop the detach
was written to prevent. `stop()` is now async and awaits the settled in-flight barrier; both module
runtimes and the web composition root await it in turn.

Also settled here: the seam-error **kind** is the one part of the feed contract that crosses as a
bare string, because `SeamFeed.read`'s error is a consumer-owned structural `{ kind: string }` and
importing the producer's `RenderError` would be a shared kernel. Nothing pinned the two sides to the
same literal, so a rename on one side alone would degrade the halt into a silent hold. Each module
now declares its published kinds in a `seam-contract.json` its own contract tier owns, and both
tiers pin both roles against those files — the same cross-package *file read* the recorded event
fixtures already use, which keeps `src` free of the import.

## Open Questions

- ~~Whether the boundaries tier imports `eslint.config.js` via `allowJs` or a hand `.d.ts`.~~
  Settled as `allowJs` — see D8.
