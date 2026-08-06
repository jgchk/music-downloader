# Design — deterministic-floor

## Context

`docs/research/automated-quality-function.md` (2026-08-05) surveyed the literature on
automated quality functions and ranked this repo's next moves. Two findings drive this
change. (1) Deployment model dominates analyzer power (Meta: identical analyzer, ~0% fix
rate nightly-batch vs >70% at diff time; Google Tricorder: <10% effective-FP admission bar,
where ignored findings count as false) — and this repo's every-commit gate is already the
attested-good shape, so the remaining wins are stronger rules in the same seat, not new
seats. (2) In an unattended loop the death-spiral is worse than at Google: an agent that
cannot ignore a noisy check will *appease* it (test fiction, gratuitous waivers), so the
admission bar must be constitutional before more checks join the gate — the mutation gate
(`mutation-gate` change) is next in line and inherits this contract.

The grilled decisions this design implements: strict + stylistic typed profiles together;
sonarjs via one-shot admission review (no server, no time-boxed or warn-level trial);
`quality-gates.md` as a new constitutional doc; `/ship` mines promotion candidates into
GitHub issues; `/retro` untouched.

## Goals / Non-Goals

**Goals**

- Production lint profile at the strictest typed tier, fallout fixed, carve-outs justified.
- `eslint-plugin-sonarjs` admitted rule-by-rule under the admission contract; tally recorded
  here (see "Admission tally", filled during implementation).
- `docs/development/quality-gates.md`: admission contract + promotion ladder, linked from
  CLAUDE.md.
- `/ship` files promotion-candidate GitHub issues after review convergence.

**Non-Goals**

- No SonarQube server, Semgrep/Opengrep, or CodeQL adoption (Opengrep is a ladder rung,
  adopted when first needed). No new review agents. No mutation testing or PBT (sibling
  changes). Nothing from `close-enforcement-gaps` scope.

## Decisions

### D1 — Both strict tiers at once, carve-outs over downgrades

`strictTypeChecked` and `stylisticTypeChecked` land in one pass: same surface, same fallout
run, and the stylistic tier's churn is exactly the kind of mechanical work the factory
absorbs cheaply. A rule that fails the repo is disabled at the config site with a one-line
justification (the unicorn carve-out pattern). Blanket `warn` downgrades are forbidden — a
warning nobody blocks on is the Meta nightly-batch shape, attested-dead.

### D2 — One-shot admission review for sonarjs (rejected: time-boxed trial, warn-level trial)

The `recommended` set is enabled, run repo-wide, and every finding triaged rule-by-rule:

- **admit** — findings include ≥1 genuine defect or a real clarity win; rule stays at
  `error`, findings fixed in this change.
- **reject** — findings are all noise, or duplicate typed-eslint/unicorn coverage; rule
  disabled with a one-line justification comment.

A time-boxed trial was rejected (nobody watches between cycles; N cycles of appeasement is
the exact failure mode), warn-level was rejected (non-blocking output has no consumer here).
This triage is deliberately the first execution of the quality-gates admission contract —
if the contract text doesn't survive contact with 300-odd sonarjs findings, it gets fixed
here, before the mutation gate leans on it.

If a triage uncovers a genuine production defect, its fix is red-first (failing test, then
fix) and retitles the change's release impact to `fix:`.

### D3 — Admission tally lives in this design doc

One line per rule with findings: `rule — admitted/rejected — count — reason`. Counts are
**repo-wide** unless a line says otherwise. This is the evidence the spec delta's "admitted, not
accumulated" requirement points at.

#### strict typed tiers — 537 findings, 17 rules with findings

126 production, 411 test-tier. Notably **zero** `no-unsafe-*`: those already ship in
`recommendedTypeChecked`, so the boundary-parsing exposure was already covered and the fallout is
smaller and duller than the proposal assumed. 64 findings were autofixable; 3 rules rejected:

| rule | count | reason |
| --- | --- | --- |
| `no-non-null-assertion` | 241 repo-wide (38 production) | 33 of the 38 are indices already bounded by their own loop or a length guard. With `noUncheckedIndexedAccess` **and** 100% branch coverage both enforced, replacing one adds an unreachable branch that must then be waived with `v8 ignore` — trading a visible assertion for an invisible one. That coverage argument does not cover 12 of the 38, which sit outside the coverage gate (`__fixtures__`, `packages/*/scripts`, `scripts/release`); those rest on the plainer ground that the guard would be unreachable noise. |
| `no-empty-function` | 34 | Three sanctioned shapes, two of them production: `.map(() => {})` narrowing `ResultAsync<T, E>` to `ResultAsync<void, E>`; the beets bridge's promise-queue tail `next.then(() => {}, () => {})`, which is neither a `.map` nor a test double; and the no-op port method, disposer, or callback on a test double implementing a port it does not exercise. 34/34 false. |
| `no-invalid-void-type` | 31 | Every finding is `okAsync<void, E>()`, `errAsync<void, E>()`, `ok<void, E>()`, `ResultAsync.fromSafePromise<void>()` or `Promise.withResolvers<void>()`. `allowInGenericTypeArguments` covers type references, not call-site type arguments — no option separates them. 31/31 false. |

**Counts here are the triage-time inventory, and the tree has moved since.** The table above is
retained as-is because the 537 total is built from it; the config comments at the disable sites
carry the re-measured numbers, since that is what a reader arming a rule today will see. Re-measured
on the merge-time tree — this change was rebased onto v3.17.4, which landed a property-test harness
in both packages and a whole slskd contract tier after the triage ran:

| rule | triage-time | merge-time | what moved |
| --- | --- | --- | --- |
| `no-non-null-assertion` | 241 (38 production) | **270** (38 production, 232 test code) | Production is unchanged — the reviewed-one-by-one subset is still the same 38 sites in the same files, so the 33-of-38 and 12-of-38 splits above stand. Every added finding is test-code `arr[0]!` / `mock.calls[0]!` fixture indexing in tiers that landed after triage. |
| `no-empty-function` | 34 | **35** | One more: the slskd contract tier's `{ progress: () => {}, finished: () => {} }` port doubles — sanctioned shape (3), so the verdict is now 35/35 false. |
| `no-invalid-void-type` | 31 | **31** | Unchanged. |

The rejection reasoning is unmoved by this: every added finding falls inside a shape already
triaged. Had one landed outside them, that would have been cause to revisit the disable itself, not
merely to restate a count.

**`no-unnecessary-condition` was initially rejected here and is now ARMED.** The original rejection
(11 findings, 5 false) was reversed during review. The false positives are not spread across the
repo: they cluster in **5 files** — the wakeup-coalescing `pending` flag and the slskd watch
`aborted` latch — and both are the same TypeScript limit, narrowing that is not invalidated across
an `await`. Five narrow `eslint-disable-next-line` waivers at those sites are a better trade than a
repo-wide disable, because they name the limit at the place it bites instead of blinding the rule
everywhere. Its **6 true positives were fixed**, and two of them earned the re-arm on their own:
casts (`as unknown[]`, `as keyof typeof`) that lied to the type system and thereby made a
load-bearing `??` look dead. A rule that finds a cast hiding a live fallback is doing exactly the
job the admission contract asks for.

Two rules were tuned rather than disabled (`restrict-template-expressions` with `allowNumber` and
every other boolean allowance pinned explicitly — the rule's default
`allow: [Error, URL, URLSearchParams]` survives the merge and is deliberately left in force;
`no-confusing-void-expression` with `ignoreArrowShorthand`).

**Admitted, with counts** (the other 14 rules with findings — every one fixed rather than waived):
`restrict-template-expressions` 108 (tuned), `dot-notation` 52, `no-confusing-void-expression` 35
(tuned), `no-unnecessary-condition` 11 (re-armed, see above), `consistent-type-definitions` 8,
`no-deprecated` 4, `no-misused-spread` 2, `array-type` 2, `no-unnecessary-type-arguments` 2,
`prefer-optional-chain` 2, `prefer-nullish-coalescing` 2, `restrict-plus-operands` 1,
`no-dynamic-delete` 1, `no-unnecessary-type-parameters` 1.

**Recorded scope limit:** the strict tiers are armed over `**/*.ts` only, so a `.svelte` file's
`<script lang="ts">` block is **not** covered by the typed profile — svelte-check does that job.
This is a deliberate hole, not an oversight; reversing it is a decision, not a discovery.

#### sonarjs (`recommended`, 279 rule keys / 217 armed) — 130 findings, 18 rules with findings

As with the strict-tier table, these counts are the **triage-time inventory** — the one-shot
repo-wide run this admission review was decided on, taken before the rebase onto v3.17.4. A reader
arming `recommended` today will see different totals as the test tiers grow; that is drift in the
measurement, not in the verdict. What is durable is the per-rule reasoning below and the one
admitted rule, and the one admitted rule is enforced by the gate, so it cannot silently rot.

**Admitted: 1.**

| rule | count | reason |
| --- | --- | --- |
| `prefer-specific-assertions` | 8 | ~0% FP, all 8 a keystroke to fix. Three rewrites were applied: `expect(x.length).toBe(n)` → `toHaveLength(n)`, `toBe(null)` → `toBeNull()`, and the e2e site's `includes(…)).toBe(true)` → `toContain(…)`, which turns "expected false to be true" into a printed haystack, in the tier where reproducing a failure costs most. |

**Rejected: 17.** No rule other than the above found a genuine defect; the four likeliest
candidates were each traced to ground and are false.

| rule | count | reason |
| --- | --- | --- |
| `void-use` | 39 | Every finding is `void expr` discarding a return inside a void-returning callback (`(l) => void lines.push(l)`) — the idiom that satisfies the signature, not fire-and-forget. |
| `cognitive-complexity` | 15 | Charges +1 nesting per guard inside a switch arm, so it fires on every exhaustive decide/evolve/react decider — the pattern the codebase is built on. 2 arguable wins / 15 ≈ 87% FP. |
| `no-clear-text-protocols` | 14 | Fake-hostname fixture URLs only (`http://slskd:1234`). The one production `http://` is a localhost default the rule already exempts. |
| `no-unused-vars` | 13 | Pure duplicate of the configured `@typescript-eslint/no-unused-vars`, minus its `^_` exemption — it flags only the destructuring-rest omit idiom, whose binding cannot be removed. |
| `no-os-command-from-path` | 9 | `git`/`jj` in release tooling, `ffmpeg`/`ffprobe` in the fixture recorder — dev-machine tools. The shipped bare-name spawns are pinned in the Docker image and were not flagged. |
| `no-floating-point-equality` | 6 | Exact round-trip/passthrough assertions with zero arithmetic; a tolerance would weaken the very property under test ("preserves the value"). |
| `super-linear-regex` | 4 | Quadratic in form, unreachable in fact: remote-sourced paths are slash-sanitized at the producer, so `/\/+$/` fails in O(1) at every start position. No attacker reach. |
| `hardcoded-secret-signatures` | 4 | `createHmac` with in-file literal test secrets (`'unit-test-secret'`). An independent high-entropy sweep found zero real credentials in the repo. |
| `no-nested-conditional` | 4 | Fires on the standard comparator idiom (`a < b ? -1 : a > b ? 1 : 0`) and short band ladders; no finding is harder to read than its "fixed" form. |
| `concise-regex` | 3 | `[0-9]` ≡ `\d` here, and the flagged regex deliberately mirrors an upstream implementation verbatim so the changelog assembles identically. |
| `no-redundant-optional` | 3 | The `\| undefined` marks intentionally-meaningful explicit `undefined` (matched by `in`-checks) and becomes mandatory under `exactOptionalPropertyTypes`. |
| `no-fallthrough` | 2 | tsc's `noFallthroughCasesInSwitch` is already on and is type-aware; this rule is syntactic and flags exhaustive-union inner switches it cannot see are total. Adding `break`s would be dead code that also suppresses the tsc guard. |
| `no-nested-template-literals` | 2 | One arguable readability nit in an error string; the other a one-level nest inside a replacer callback. |
| `duplicates-in-character-class` | 1 | An intentional `\s` ∪ control-range union where neither member is removable without changing behaviour. |
| `no-nested-assignment` | 1 | One parenthesised monotonic counter in a test-fixture factory. |
| `publicly-writable-directories` | 1 | One `/tmp` string in a contract-test config bag, never written to. |
| `no-skipped-tests` | 1 | Playwright's conditional `test.skip(cond, reason)` environment gate — the legitimate form, and the repo's only skip. |

**Consequence for the config.** Only the admitted rule is enabled — not `recommended` with
seventeen `'off'` lines. That is itself an admission-contract call, and the measurement is the
argument: the full set cost roughly **+16s (~+65%)** on cold lint, the gate's longest lane, while
the single admitted rule costs about **+0.3s (~+1%)**. The figures are approximate on purpose — two
independent measurements on the same tree came out at +15.7s/+63% and +17.1s/+66% (and +0.3s/+1.2%
for the single rule) — because that is the precision a wall-clock lint benchmark has; quoting one
decimal place would claim more than the method supports. A rule that is switched off still costs the
time to decide it does not apply. Task 2.4 (drop the plugin on a zero-admission triage) therefore does not
fire — one rule was admitted, so the dependency stays and earns its place.

#### Real defect surfaced by the strict tier

`no-unnecessary-condition` flagged the `??` in `packages/web/src/routes/login/+page.server.ts` as
dead. It was not dead — the `LOGIN_ERROR_MESSAGES[code as keyof typeof …]` cast in front of it told
the type system every string was a key, so the type system could not see the fallback doing work.
The runtime consequence, on an unauthenticated GET with a user-writable query parameter:

| `?error=` | before | after |
| --- | --- | --- |
| `expired` | the expired message | unchanged |
| `wat` | the generic message | unchanged |
| `toString` | **a Function** | the generic message |
| `__proto__` | **Object.prototype** | the generic message |
| `constructor` | **a Function** | the generic message |

A prototype-chain lookup reached past the literal and returned a non-string where the page data
declares `string | undefined`. Fixed by testing membership (`Object.hasOwn`) instead of asserting
it. This is the change's one genuine production defect, and it is a good advertisement for the
thesis: the rule that found it was one this change had initially *rejected*, and the finding only
became visible once the rejection was narrowed to per-site waivers during review.

**Two follow-ups surfaced by the triage, independent of the lint decision:** `slskd/download.ts`
`runWatch` is a genuinely long supervisor loop (complexity 28, nested try/catch/finally, six
mutable locals), and the `walk` schema-differ is duplicated **verbatim** across both packages'
`scripts/contracts/event-schemas.ts`.

### D4 — `quality-gates.md` is constitutional, not OpenSpec

The contract governs *how we build* (what earns gate membership, how English rules become
machine rules) — `docs/development/` altitude, no domain specifics. Contents: the admission
contract (<10% effective FP, actionable-only, appeasement counts against), the four-rung
promotion ladder (`no-restricted-syntax` → local ESLint rule → Opengrep dataflow rule →
type-level unrepresentability, each rung named with when-to-stop guidance), and the waiver
doctrine cross-reference (justified like an `any`). The spec delta in this change pins the
gate-membership requirement; the doc carries the mechanics.

### D5 — `/ship` promotion mining: post-convergence, issues not PR bodies

After review convergence (zero findings), the ship flow adds one step: scan the cycle's
applied findings for (a) any finding class that appeared ≥2 times across cycles, (b) any
finding whose fix was purely mechanical. Each candidate becomes one GitHub issue titled
`promote: <rule sketch>`, labeled `quality-gate`, body naming the finding instances, the
proposed ladder rung, and the admission-contract bar it must clear. Issues are the durable
channel — the factory must not depend on a human reading PR bodies. `/retro` remains
standalone (session-level process retro is a different altitude than per-change finding
mining).

## Risks / Trade-offs

- **Strict-tier fallout volume is unknown until run.** Mitigation: mechanical-fix commits
  separated from judgment commits; carve-out escape hatch is cheap and documented.
- **Sonarjs may admit ~nothing.** That is a valid outcome, recorded in the tally — the
  plugin then costs one dependency and a config block for a handful of live rules; if
  *zero* rules are admitted the plugin is dropped entirely and the tally records why.
- **Promotion issues could accumulate unread.** Accepted for now: the queue is visible, and
  `/retro` naturally reviews open `quality-gate` issues; a staleness policy can follow.
- **Two changes editing `eslint.config.js`** — sequencing after `close-enforcement-gaps` is
  mandatory, not advisory (see proposal Impact).

## Migration Plan

Single change, three commit lanes: (1) profile bump + fallout (mechanical), (2) sonarjs +
triage fixes (+ any red-first `fix:`), (3) constitution doc + CLAUDE.md link + `/ship` step.
No runtime migration; revert is config-local per lane.

## Open Questions

- None blocking. The admission tally and the final carve-out list are implementation
  outputs, recorded here when known.
