# How do we lint-enforce "never ignore a Result", and how do mature TS monorepos lint+typecheck their scripts and test tiers?

**Research date:** 2026-08-05.

**Question.** Review found two enforcement gaps. (1) `docs/development/error-handling.md` promises
"an unhandled result is a bug, and the linter flags it" — but no such lint rule exists; a
discarded synchronous `Result` (or an awaited-then-discarded `ResultAsync`) is silently legal,
and at least one live instance exists (`reset()` discarding `checkpoints.save`'s Result,
`packages/importer/src/application/events/catch-up-subscription.ts:128`). (2) `scripts/**`,
`test/e2e/**`, `test/boundaries/**`, `packages/*/test/contract/**`, `packages/*/test/bridge/**`
and every `*.config.ts` sit in eslint's global `ignores` *and* in no tsconfig (packages
`include: ["src"]`) — unlinted, untypechecked. Relatedly, `import/no-restricted-paths` is scoped
to `**/*.ts`, so `.svelte` files escape the dependency-rule zones. Three research forks: (1) the
right mechanism to flag a discarded neverthrow `Result`; (2) how attested monorepos bring
scripts/test tiers under lint + typecheck, and whether tests get a relaxed rule profile; (3)
whether import-boundary rules can cover `.svelte` files.

**Method.** House constraints read first (`docs/development/coding-standards.md`,
`error-handling.md`, `testing.md`, `eslint.config.js`, the package tsconfigs, and the *resolved*
tool versions from the lockfile — eslint 10.7.0, typescript-eslint 8.65.0, TypeScript 6.0.3,
neverthrow 8.2.0, eslint-plugin-svelte 3.22.0, eslint-plugin-import 2.32.0, vitest 4.1.10,
Svelte 5). Primary sources fetched 2026-08-05: the neverthrow package as installed (its shipped
`index.d.ts` and README) and its GitHub issue tracker; the npm registry (publish dates and peer
ranges queried via `npm view`, since npmjs.com blocks fetches); the candidate plugins' READMEs
and rule source on GitHub; typescript-eslint's docs and its own monorepo config files (fetched
verbatim from `main`); the TypeScript project-references handbook; tRPC's and vitest's repos;
vitest's docs; eslint-plugin-svelte / svelte-eslint-parser docs and issues; eslint-plugin-import-x
docs; dependency-cruiser docs. In addition, fork 1's finalist was **empirically trial-run against
this repo** (plugin installed in an isolated scratch directory, repo untouched) — violation
counts below are measured, not estimated. Citations inline; sources gathered in §6.

---

## 1. House facts being decided against

- The constitution's claim: "**Never ignore a result.** An unhandled result is a bug, and the
  linter flags it" (`docs/development/error-handling.md`). No rule currently backs the second
  clause: the repo's typed lint is `recommendedTypeChecked` + unicorn + import zones
  (`eslint.config.js`), none of which sees a discarded `Result`.
- neverthrow 8.2.0's `ResultAsync` **is a thenable, not a Promise**:
  `declare class ResultAsync<T, E> implements PromiseLike<Result<T, E>>`
  (`node_modules/.pnpm/neverthrow@8.2.0/…/dist/index.d.ts:5`). So `await` yields a `Result` — and
  the awaited call site is then invisible to every Promise-flavored rule.
- The eslint `ignores` block excludes the whole out-of-src world — `test/e2e/**`,
  `test/boundaries/**`, `packages/*/test/contract/**`, `packages/*/test/bridge/**`, `scripts/**`,
  `packages/*/scripts/**`, `**/*.config.ts`, `**/*.config.js`, `packages/web/tests/**`,
  `packages/web/playwright.config.ts` — with a comment explaining why: they are "not part of the
  src-scoped TypeScript projects (tsconfig `include: ["src"]`); keep them out of the type-checked
  lint to avoid projectService 'file not in project' errors" (`eslint.config.js:112-137`). The
  cause is the tsconfig gap; the eslint gap is downstream of it.
- Tier sizes (measured): `scripts/` 14 TS files, `test/e2e/` 6, `test/boundaries/` 1,
  `packages/*/test/contract/` 36, `packages/*/scripts/` 4, `packages/web/tests/` 4, plus ~15
  config files — roughly **65 TS files** currently outside both gates. (`test/bridge` is Python;
  it has its own native tier.)
- The dependency rule is enforced with `import/no-restricted-paths` zones under
  `files: ['**/*.ts']` (`eslint.config.js:196-225`); `.svelte` files get only
  `svelte.configs['flat/recommended']` plus a files-scoped `no-restricted-imports` for the
  runtime-entry ban — the *zones* don't apply to them.
- Version pin that matters: repo memory records TS v7 as deferred (ts-eslint crash), so any
  candidate requiring a TypeScript upgrade is disqualified.

---

## 2. Fork 1 — flagging a discarded neverthrow `Result`

### 2.1 What the existing rule set can and cannot see

- **`no-unused-expressions`** never fires on a bare call: "This rule does not apply to function
  calls or constructor calls with the `new` operator, because they could have *side effects*"
  ([eslint docs](https://eslint.org/docs/latest/rules/no-unused-expressions)). A discarded
  `checkpoints.save(...)` is a call — invisible.
- **`no-confusing-void-expression`** targets the inverse problem — a *void*-typed expression used
  where a value is expected ([typescript-eslint docs](https://typescript-eslint.io/rules/no-confusing-void-expression/)).
  A Result-typed expression statement is not its concern.
- **`no-floating-promises` + `checkThenables`**: the option — "Whether to check all 'Thenable's,
  not just the built-in Promise type. Default: false"
  ([rule docs](https://typescript-eslint.io/rules/no-floating-promises/)) — *would* make a
  floating `ResultAsync` visible, because `ResultAsync implements PromiseLike` (§1). But the rule
  counts `await` itself as handling ("Using `await`" satisfies it, regardless of what happens to
  the awaited value). Two structural gaps remain: **synchronous `Result` is never covered**, and
  **`await someResultAsync()` as a bare statement passes** — which is exactly the live instance
  (`catch-up-subscription.ts:128` awaits `checkpoints.save` and discards the `Result`). Worth
  enabling as defense-in-depth, but it cannot be the enforcement mechanism.

### 2.2 The eslint-plugin-neverthrow lineage: original dead, forks alive

- neverthrow's shipped README still says "Recommended: Use `eslint-plugin-neverthrow`", created
  under the project's bounty program ([issue #314](https://github.com/supermacro/neverthrow/issues/314))
  as "essentially a porting of Rust's `must-use`" (README as packaged in neverthrow 8.2.0). That
  recommendation is stale: the original `eslint-plugin-neverthrow` last published **1.1.4 on
  2021-11-09** (npm registry), peers `eslint >=5.16.0` / `@typescript-eslint/parser >=4.20.0`,
  legacy-config era. An open issue on neverthrow itself (March 2025) reports it "no longer
  maintained (or working with TypeScript)"
  ([supermacro/neverthrow#625](https://github.com/supermacro/neverthrow/issues/625)); the docs
  were never updated with an official successor.
- Community successors, all single-rule (`must-use-result`), all requiring typed linting
  (npm registry metadata, 2026-08-05):

  | package | latest | published | key peers |
  |---|---|---|---|
  | `eslint-plugin-neverthrow` (original) | 1.1.4 | 2021-11-09 | eslint >=5.16 |
  | `@tunnel/eslint-plugin-neverthrow` | 0.0.11 | 2024-03-26 | (stale) |
  | `eslint-plugin-neverthrow-must-use` | 0.1.2 | 2025-03-11 | eslint ^9, parser ^8 |
  | `@bufferings/eslint-plugin-neverthrow` | 0.3.0 | 2025-12-06 | eslint >=9, parser >=8.48, TS >=5.6 |
  | **`@ninoseki/eslint-plugin-neverthrow`** | **0.2.0** | **2026-05-20** | **eslint >=10.0.3** |

- The **@ninoseki fork** self-describes as "eslint-plugin-neverthrow but works with ESLint v10"
  (npm), and its devDependencies are this repo's stack almost verbatim: `typescript ^6.0.3`,
  `typescript-eslint ^8.59.4`, `eslint ^10.4.0`, `neverthrow ^8.2.0`, `vitest ^4.1.6` (npm
  registry). That is the strongest compatibility evidence available for our exact pins — it is
  *developed against* TS 6.0.3 + eslint 10, where every alternative merely doesn't exclude them.
  Caveat: like the whole lineage it still depends on `tsutils@3.21.0` (pre-`ts-api-utils`,
  TS 3.x-era peer range) — it works today (§2.4) but is the fork's main modernization debt.
- Rule mechanics (from the fork's `must-use-result.ts` source): Result detection is
  **structural** — a type having all of `mapErr, map, andThen, orElse, match, unwrapOr` — not by
  package name; "handled" means one of **`match`, `unwrapOr`, `_unsafeUnwrap`** is *called*;
  a bare `await resultAsyncCall()` statement **is flagged** (the awaited Result is unconsumed);
  assignment doesn't discharge the obligation — the rule follows the variable's references.

### 2.3 The general-purpose alternatives

- **eslint-plugin-functional `no-expression-statements`** (v10.0.0, 2026-06-03, peers
  `eslint ^9||^10`, `typescript >=4.7.4` — compatible): with `ignoreVoid: true` (typed) it
  forbids *every* bare call whose type isn't `void`/`Promise<void>`
  ([rule docs](https://github.com/eslint-functional/eslint-plugin-functional/blob/main/docs/rules/no-expression-statements.md)).
  It would catch both Result gaps — as a side effect of banning **all** discarded non-void
  returns (`array.push`, `map.set`, …), a far larger behavioral change than the constitution
  asks for. Right tool for a strict-FP codebase; oversized here.
- **A small custom typed rule**: typescript-eslint documents the toolchain
  ([Custom Rules](https://typescript-eslint.io/developers/custom-rules/)), and the entire
  must-use-result lineage is a single ~200-line rule — forking it in-repo is a real option if the
  maintained forks ever lapse. No maintained *community rule set* beyond the forks in §2.2 was
  found; practitioners converge on the same single rule.
- **`must_use` in the language**: TypeScript has no `@nodiscard`. The suggestions are open and
  unadopted after a decade — "`Result value must be used` check"
  ([microsoft/TypeScript#8240](https://github.com/microsoft/TypeScript/issues/8240), 2016) and
  "Implement no discard error for return values"
  ([#29173](https://github.com/microsoft/TypeScript/issues/29173)). Lint is the only enforcement
  altitude available.

### 2.4 Empirical trial against this repo (measured 2026-08-05)

`@ninoseki/eslint-plugin-neverthrow@0.2.0` was installed in an isolated scratch directory with
eslint 10.7.0 / typescript-eslint 8.65.0 / TypeScript 6.0.3 and run over `packages/*/src/**/*.ts`
with `projectService: true` against the repo's own tsconfigs. **It runs cleanly on our exact
stack** — no TS-version or eslint-10 breakage. Findings:

- **Production src (excluding co-located `*.test.ts`): 9 violations.**
  - **3 true positives** — the two `reset()` implementations discarding the awaited
    `checkpoints.save` Result (`packages/{downloader,importer}/src/application/events/catch-up-subscription.ts:142/:128`)
    and a fixture discarding `interpretEffect`'s outcome
    (`packages/importer/src/facade/__fixtures__/wiring.ts:72`). The rule finds precisely the bug
    class the constitution names, including the awaited-then-discarded shape no Promise rule sees.
  - **6 false positives, all one idiom** — a `ResultAsync` passed *as an argument* to a
    best-effort handler that awaits and logs it
    (`transfer-ledger.ts` ×4, `search.ts` ×2, e.g.
    `await this.record(this.ledger.recordCreated({...}), 'record transfer')`). The rule's
    "handled" set is only `match`/`unwrapOr`/`_unsafeUnwrap`; delegating a Result to a callee is
    not recognized. These sites are *deliberately* fire-and-forget ("Run a ledger write without
    letting a stewardship fault fail an otherwise-working download") and would need either a
    refactor (helper takes a thunk and does its own `.match`) or a per-site disable comment.
- **Co-located `*.test.ts`: 336 violations.** Tests routinely call Result-returning functions and
  assert via other means. Enabling the rule over tests as-is is not viable without a sweep or an
  exemption.

---

## 3. Fork 2 — bringing scripts and test tiers under lint + typecheck

### 3.1 The documented recommendation: tsconfig coverage first, `allowDefaultProject` sparingly

typescript-eslint's own docs rank the remedies for "file not in project": "If possible, add the
file to the closest `tsconfig.json`'s `include`" comes first; `projectService.allowDefaultProject`
is only for "a small number of 'out of project' files" — it forbids `**` globs, defaults to a
hard cap of **8** out-of-project files, and "Every file with type information retrieved from the
default project incurs a non-trivial performance overhead to linting. Use this option sparingly"
([typed-linting troubleshooting](https://typescript-eslint.io/troubleshooting/typed-linting/),
[parser docs](https://typescript-eslint.io/packages/parser/)). With ~65 files across our tiers,
`allowDefaultProject` is disqualified as the mechanism; per-tier tsconfigs are the documented
path. (The [Project Service blog post](https://typescript-eslint.io/blog/project-service/) frames
`allowDefaultProject` as the successor to the old `tsconfig.eslint.json` hack — for stray config
files, not tiers.)

### 3.2 Shape A — composite per-tier projects (typescript-eslint's own monorepo)

The typescript-eslint repo puts **every file in some tsconfig project** and uses zero eslint
escape hatches (its `eslint.config.mjs` sets only `projectService: true`; global ignores are
fixtures and a vendored dir — tests and tools are linted with the full typed profile). Per
package: `tsconfig.json` is a pure solution file (`"files": []`, references to
`tsconfig.build.json` + `tsconfig.spec.json` + `tsconfig.tools.json`); the shared
`tsconfig.build.json` includes `${configDir}/src` and *excludes* `src/**/*.test.ts`; the shared
`tsconfig.base.json` (`"composite": true`) already includes `${configDir}/tests`,
`${configDir}/vitest.config.mts` via TS 5.5+ `${configDir}` substitution; spec/tools configs
reference the build project. Root config files get a dedicated
`tsconfig.repo-config-files.json` (including `eslint.config.mjs` itself), and a root solution
`tsconfig.json` references everything for `tsc -b`
([eslint.config.mjs](https://github.com/typescript-eslint/typescript-eslint/blob/main/eslint.config.mjs),
[tsconfig.base.json](https://github.com/typescript-eslint/typescript-eslint/blob/main/tsconfig.base.json),
[tsconfig.build.json](https://github.com/typescript-eslint/typescript-eslint/blob/main/tsconfig.build.json),
[root tsconfig.json](https://github.com/typescript-eslint/typescript-eslint/blob/main/tsconfig.json),
[tsconfig.repo-config-files.json](https://github.com/typescript-eslint/typescript-eslint/blob/main/tsconfig.repo-config-files.json)).
This is the TS handbook's own motivating example scaled up: `test/tsconfig.json` with
`"references": [{"path": "../src"}]`, composite referenced projects, a root solution file with
empty `files` ([Project References handbook](https://www.typescriptlang.org/docs/handbook/project-references.html)).

### 3.3 Shape B — one wide "check" tsconfig, one narrow build tsconfig (tRPC, vitest)

tRPC inverts the direction with no composite/references: the root `tsconfig.json` is the
*everything* project — `"include": ["packages", "types", "scripts", "examples"]` (scripts
explicitly included) — while `tsconfig.build.json` narrows with
`"exclude": ["test", "**/*.test.ts", ...]` and per-package build configs include only `src`
([tRPC tsconfig.json](https://github.com/trpc/trpc/blob/main/tsconfig.json),
[tsconfig.build.json](https://github.com/trpc/trpc/blob/main/tsconfig.build.json)). vitest keeps
a dedicated whole-repo `tsconfig.check.json` for `--noEmit` checking, separate from build paths
([vitest tsconfig.check.json](https://github.com/vitest-dev/vitest/blob/main/tsconfig.check.json)).
Either shape satisfies `projectService` — what matters is that every linted file lands in *some*
tsconfig whose include claims it, and that build/spec includes stay **disjoint** so no file is
claimed twice (typescript-eslint's build config excludes `src/**/*.test.ts` for exactly this
reason). Performance guidance: avoid `**/*`-wide includes ("it can cause many more files than you
expect to be included in this pre-parse"); project references "can be helpful to speed up type
checking on larger projects"
([performance docs](https://typescript-eslint.io/troubleshooting/typed-linting/performance/)).

### 3.4 vitest `typecheck` is a complement, not a substitute

vitest 4's `typecheck` runs `tsc --noEmit` alongside tests, but its *test* semantics target
dedicated `*.test-d.ts` type-assertion files (default include
`['**/*.{test,spec}-d.?(c|m)[jt]s?(x)']`; such files are "only statically analyzed by the
compiler") ([config](https://vitest.dev/config/typecheck),
[guide](https://vitest.dev/guide/testing-types)). typescript-eslint's repo uses it *and* keeps
tests in `tsconfig.spec.json` — eslint's projectService knows nothing about vitest's typecheck
run, so it cannot stand in for tsconfig coverage.

### 3.5 Test tiers get the full typed profile plus a short, explicit relaxation

typescript-eslint lints its tests with `strictTypeChecked` and then relaxes a *named* set for
test globs only: `no-non-null-assertion`, the four `no-unsafe-*` rules, and an
`no-empty-function` allowance — while turning *on* extra test-discipline rules from
`@vitest/eslint-plugin` (`no-focused-tests`, `no-disabled-tests`, `valid-expect`, …) scoped to the
same globs ([eslint.config.mjs](https://github.com/typescript-eslint/typescript-eslint/blob/main/eslint.config.mjs);
[@vitest/eslint-plugin](https://github.com/vitest-dev/eslint-plugin-vitest) documents the same
files-scoped idiom). The pattern in the wild is consistent: **full production rule set as the
baseline, a small documented carve-out, never a separate lesser config** — this repo's existing
`**/*.test.ts` block (`no-non-null-assertion`, `unbound-method` off) is already the same shape.

---

## 4. Fork 3 — dependency-rule zones over `.svelte` files

### 4.1 `import/no-restricted-paths` works on `.svelte` — verified empirically on this toolchain

A scratch repro using this repo's own installed binaries (eslint 10.7.0,
eslint-plugin-import 2.32.0, eslint-plugin-svelte 3.22.0, typescript-eslint 8.65.0,
eslint-import-resolver-typescript 4.4.5) confirmed: with svelte-eslint-parser +
`parserOptions.parser: tseslint.parser` (the repo's existing wiring) and a config block whose
`files` covers `'**/*.svelte'`, **`import/no-restricted-paths` fires inside a
`<script lang="ts">` block** — for both `.ts` imports and `.svelte`-component imports, at
correct line/col, identically to a `.ts` control file. The only resolver change needed was
adding `.svelte` to the node resolver's extensions (Svelte imports carry an explicit `.svelte`
extension, so the literal-file check resolves them; SvelteKit's `$lib` resolves via the
generated `.svelte-kit/tsconfig.json` through the existing typescript resolver —
[resolver README](https://github.com/import-js/eslint-import-resolver-typescript) lists no
`.svelte` default). This matches eslint-plugin-import's own position: "You'd need to use an
eslint parser that can support `.svelte` files… it should Just Work"
([import-js#2386](https://github.com/import-js/eslint-plugin-import/issues/2386)). Production
attestation in flat config + Svelte 5: GraphiteEditor/Graphite applies
`pluginImport.flatConfigs.recommended` + `svelte flat/recommended` globally with `import/order`
and `no-restricted-imports` governing `.svelte` files
([Graphite eslint.config.js](https://github.com/GraphiteEditor/Graphite/blob/master/frontend/eslint.config.js)).

### 4.2 The rule class that does NOT work: ExportMap-family import rules

`import/no-cycle`, `no-duplicates`, `no-unused-modules`, `no-named-as-default*` build an export
map by re-parsing *imported* modules — and that machinery never sees Svelte edges. Verified in
the same repro: `no-cycle` caught a `.ts`↔`.ts` cycle but silently missed a `.svelte`↔`.svelte`
cycle, even with `import/parsers` registering svelte-eslint-parser (the parser nests
`ImportDeclaration`s inside `SvelteScriptElement`, so ExportMap's top-level walk finds nothing).
Upstream issues corroborate: re-parse errors on imported `.svelte` modules with
`"import/ignore": ["\\.svelte$"]` as the sanctioned workaround
([import-js#2837](https://github.com/import-js/eslint-plugin-import/issues/2837)), an old
autofixer-corruption report for `import/order` on svelte scripts
([#2407](https://github.com/import-js/eslint-plugin-import/issues/2407); `no-restricted-paths`
has no fixer, so unaffected), and flat config's removal of `context.parserPath` complicating
`import/parsers` generally ([eslint#16878](https://github.com/eslint/eslint/issues/16878),
[import-js#2556](https://github.com/import-js/eslint-plugin-import/issues/2556)).
`no-restricted-paths` is structurally immune: it visits only the linted file's own
`ImportDeclaration`s and resolves their paths — it never parses the imported module.

### 4.3 Alternatives surveyed

- **eslint-plugin-import-x** (4.17.1, 2026-06-28): the maintained fork, declares
  `eslint ^8.57 || ^9 || ^10` in peers (unlike eslint-plugin-import 2.32.0, whose declared range
  stops at `^9` — it works here today but under a peer-warning regime), ships
  `no-restricted-paths`, and uses the faster `unrs-resolver`
  ([README](https://github.com/un-ts/eslint-plugin-import-x)). But it documents no svelte
  support and has its own open svelte issues — `no-cycle` not working in svelte projects
  ([#480](https://github.com/un-ts/eslint-plugin-import-x/issues/480), unanswered),
  `no-duplicates` false positives ([#308](https://github.com/un-ts/eslint-plugin-import-x/issues/308)),
  parser registration for flat config still unshipped
  ([#381](https://github.com/un-ts/eslint-plugin-import-x/issues/381)). Same expected behavior
  for `no-restricted-paths`, same ExportMap blind spot.
- **eslint-plugin-boundaries** (7.1.0, 2026-07): alive, but no svelte docs; the one SvelteKit
  attestation is a failure report — SvelteKit's virtual `$app/*` modules flagged unknown, users
  gave up ([boundaries#426](https://github.com/javierbrea/eslint-plugin-boundaries/issues/426)).
  Unattested for this use; virtual-module noise is a real cost.
- **eslint-plugin-project-structure `independent-modules`** (3.14.3, 2026-03): explicitly lists
  `.svelte` among built-in extensions
  ([wiki](https://github.com/Igorkowalski94/eslint-plugin-project-structure/wiki/project%E2%80%91structure-%E2%80%8Bindependent%E2%80%91modules))
  — a viable plan B, though it would duplicate the zone definitions in a second rule language.
  **Sheriff** is TS-only ([docs](https://sheriff.softarc.io/docs/installation)) — not a fit.
- **dependency-cruiser** (18.1.1, 2026-08-02): FAQ answers "Does this work with Svelte?" with
  "Yes" — it compiles `.svelte` files with the project's own svelte compiler; Svelte 5 support
  landed in v16.6.0 ([FAQ](https://github.com/sverweij/dependency-cruiser/blob/main/doc/faq.md),
  [releases](https://github.com/sverweij/dependency-cruiser/releases)). The one tool that would
  also see *cycles* through `.svelte` components, as a lint-adjacent CI gate rather than an
  eslint rule.

---

## 5. Verdicts

### Fork 1 — Result enforcement

**What the evidence supports for these versions:** adopt
`@ninoseki/eslint-plugin-neverthrow@0.2.0` (`neverthrow/must-use-result: 'error'`) — it is the
one maintained fork whose declared support *and* dev stack match this repo exactly (eslint
>=10.0.3; developed against TS 6.0.3 / ts-eslint 8.59.x / neverthrow 8.2.0), and the trial run
proves it works on our pins with **zero** TS-upgrade pressure. Additionally enable
`no-floating-promises` with `checkThenables: true` as defense-in-depth for un-awaited
`ResultAsync` (already half-covered by `recommendedTypeChecked`, which sees only real Promises).
Do **not** reach for eslint-plugin-functional (bans all non-void discards, oversized) or wait for
the language (`#[must_use]` has no TS equivalent; issues open since 2016). Keep the in-repo
custom-rule fork as the exit strategy if the @ninoseki fork lapses — it is a single ~200-line
typed rule.

**Migration shape: small big-bang for src, explicit exemption for tests.** Production src has
only 9 findings: fix the 3 true positives (the two `reset()`s and the fixture), and settle the
one false-positive idiom (6 sites) *once* — either refactor the best-effort helpers to take a
thunk and `.match` internally, or standardize a commented per-site
`// eslint-disable-next-line neverthrow/must-use-result -- best-effort: handled by record()`.
Then turn the rule on for `packages/*/src` minus `**/*.test.ts` in one commit. For test files
(336 findings) keep the rule **off by explicit files-scoped override with a comment** (the same
documented-relaxation shape as §3.5) — a later ratchet can burn that down if wanted; a ratchet
for src is unnecessary at 9 findings.

**Pitfalls:**
- The rule requires typed linting; it must live inside the `projectService` block, and any file
  it covers must be in a tsconfig (couples fork 1 to fork 2 for scripts/tiers).
- "Handled" is only `match`/`unwrapOr`/`_unsafeUnwrap` — passing a Result to another function,
  `ResultAsync.combine` arguments, and handler-delegation idioms all flag; decide the house
  idiom for intentional handoff *before* enabling.
- Detection is structural (any type with the six Result methods) — a non-neverthrow type that
  happens to match would also be policed; none exists in this repo today.
- The whole lineage still rides `tsutils@3.21.0` (TS 3.x-era, superseded by `ts-api-utils`);
  works on TS 6.0.3 today (measured) but re-verify on any TS bump — and repo memory already
  blocks TS 7 for other reasons.
- The upstream README's recommendation of the original plugin is stale
  ([supermacro/neverthrow#625](https://github.com/supermacro/neverthrow/issues/625)); don't cite
  it as authority for package choice.

### Fork 2 — tiers under lint + typecheck

**What the evidence supports:** per-tier tsconfig coverage, not eslint escape hatches.
`allowDefaultProject` is documented for ≤8 stray files, no `**` globs, per-file program cost —
disqualified for ~65 files. Both attested shapes work with `projectService: true` unchanged;
for this repo's size, **Shape B (tRPC/vitest)** is the lower-ceremony fit: keep
`packages/*/tsconfig.build.json` as the narrow src-only build (already exists), and add small
non-composite tsconfigs that claim each tier — e.g. one per tier root
(`test/e2e/tsconfig.json`, `test/boundaries/tsconfig.json`,
`packages/*/test/contract/tsconfig.json`, `scripts/tsconfig.json`,
`packages/*/scripts/tsconfig.json`) extending `tsconfig.base.json`, plus a root config-files
project for `*.config.ts` and `eslint.config.js` (typescript-eslint lints its own eslint
config). Wire them into `pnpm typecheck` (`tsc --noEmit -p` each, or graduate to a root solution
file + `tsc -b` later — Shape A is the upgrade path, not a prerequisite). Then delete the tier
paths from eslint `ignores`; projectService picks the new projects up with zero eslint-config
changes. vitest `typecheck` stays out of scope — it is for `*.test-d.ts` type assertions, not a
substitute for tsconfig coverage.

**Migration shape: ratchet by tier, one tier per commit.** Each tier is independently small
(1–36 files); un-ignoring all 65 at once multiplies unknown findings across unicorn + typed
rules. Order by blast radius: `scripts/` (has its own vitest tier already) → `test/boundaries/`
→ `packages/*/test/contract/` → `test/e2e/` → config files. Give tiers the same short relaxed
profile tests already get (§3.5): baseline = full production set; per-glob carve-out
(`no-non-null-assertion`, `unbound-method`, plus `no-console` for scripts) with a comment per
relaxation. Resist inventing a lesser "tier config" — the attested pattern is full profile +
named exceptions.

**Pitfalls:**
- Keep tsconfig includes **disjoint**: a file claimed by two projects (e.g. a tier tsconfig and
  a widened package tsconfig) errors under projectService; typescript-eslint excludes
  `src/**/*.test.ts` from its build config for exactly this reason.
- Don't use `**/*`-wide includes (pre-parse blowup per the performance docs); name directories.
- `noUnusedLocals`/`noUnusedParameters` from `tsconfig.base.json` will now police test/tooling
  code under `tsc`; tRPC's answer (delegate to eslint, disable in the check config for tests) is
  the precedent if it gets noisy.
- The e2e tier scrapes the UI and runs only on main (repo memory: blast-radius hazard) — linting
  it is safe, but a new `tsc` gate over it must be added to `pnpm check` so failures surface
  locally, not on main.
- Adding tiers to typecheck extends the commit gate's runtime; measure `pnpm check` before/after
  and consider `tsc -b` incremental builds if it regresses noticeably.

### Fork 3 — Svelte dependency zones

**What the evidence supports:** close the gap in place — no new plugin. Widen the zones block's
`files` from `['**/*.ts']` to `['**/*.ts', '**/*.svelte']` (or add a `.svelte` block carrying
the same zone arrays) and add `.svelte` to the resolver extensions
(`'import/resolver': { node: { extensions: [..., '.svelte'] }, typescript: {...} }`). This is
verified working on this repo's exact toolchain (§4.1) and attested in production flat-config
Svelte 5 repos. import-x is the eventual successor (eslint-10 peer range, same rule) but buys
nothing for svelte today; boundaries/sheriff are unattested or unfit.

**Migration shape: big-bang** — it is one config edit plus fixing whatever the zones then catch
in `packages/web` (`.svelte` files today can only violate the module-boundary and runtime-entry
zones, a small surface). Run once, fix findings, done.

**Pitfalls:**
- Only same-file rules cross the parser boundary. Never rely on ExportMap-family import rules
  (`no-cycle`, `no-duplicates`, `no-unused-modules`, `no-named-as-default*`) for `.svelte` — they
  miss Svelte edges *silently* on both eslint-plugin-import and import-x (§4.2). If
  component-graph cycles ever matter, dependency-cruiser in CI is the attested tool.
- eslint-plugin-import 2.32.0 does not declare eslint 10 in its peer range (import-x 4.17.1
  does); it works today, but that's the tripwire to watch on eslint upgrades.
- Don't register `import/parsers` for svelte in flat config — `context.parserPath` is gone and
  it still wouldn't make ExportMap rules see Svelte (§4.2).
- Zone `target`/`from` globs are directory-based and extension-agnostic, so existing zone
  definitions need no changes — only the `files` scope and resolver extensions do.

---

## 6. Sources

**Repo-local (read 2026-08-05):** `docs/development/error-handling.md`, `coding-standards.md`,
`testing.md`; `eslint.config.js`; `tsconfig.base.json`; `packages/*/tsconfig*.json`;
`package.json` + `pnpm-lock.yaml` (resolved versions); neverthrow 8.2.0 as installed
(`dist/index.d.ts`, README); trial-run reports in the session scratchpad.

**Fork 1:**
- neverthrow README (packaged 8.2.0) — "Recommended: Use eslint-plugin-neverthrow"; bounty
  [supermacro/neverthrow#314](https://github.com/supermacro/neverthrow/issues/314)
- [supermacro/neverthrow#625](https://github.com/supermacro/neverthrow/issues/625) — plugin
  "no longer maintained (or working with TypeScript)" (open, 2025-03-11)
- npm registry via `npm view` (2026-08-05): `eslint-plugin-neverthrow` 1.1.4 (2021-11-09);
  `@ninoseki/eslint-plugin-neverthrow` 0.2.0 (2026-05-20, peer eslint >=10.0.3, devDeps
  TS ^6.0.3 / ts-eslint ^8.59.4 / neverthrow ^8.2.0); `@bufferings/eslint-plugin-neverthrow`
  0.3.0 (2025-12-06); `eslint-plugin-neverthrow-must-use` 0.1.2 (2025-03-11);
  `@tunnel/eslint-plugin-neverthrow` 0.0.11 (2024-03-26); `eslint-plugin-functional` 10.0.0
  (2026-06); `tsutils@3.21.0` peer range
- [ninoseki/eslint-plugin-neverthrow](https://github.com/ninoseki/eslint-plugin-neverthrow) —
  README + [`src/rules/must-use-result.ts`](https://raw.githubusercontent.com/ninoseki/eslint-plugin-neverthrow/main/src/rules/must-use-result.ts)
  (structural detection; handled = match/unwrapOr/_unsafeUnwrap; await flagged; reference tracking)
- [bufferings/eslint-plugin-neverthrow](https://github.com/bufferings/eslint-plugin-neverthrow)
- [no-floating-promises](https://typescript-eslint.io/rules/no-floating-promises/) —
  `checkThenables` default false; await satisfies the rule
- [no-unused-expressions](https://eslint.org/docs/latest/rules/no-unused-expressions) — calls
  exempt; [no-confusing-void-expression](https://typescript-eslint.io/rules/no-confusing-void-expression/)
- [functional/no-expression-statements](https://github.com/eslint-functional/eslint-plugin-functional/blob/main/docs/rules/no-expression-statements.md)
  — `ignoreVoid` requires type info
- [microsoft/TypeScript#8240](https://github.com/microsoft/TypeScript/issues/8240),
  [#29173](https://github.com/microsoft/TypeScript/issues/29173) — no `@nodiscard` in TS
- [typescript-eslint Custom Rules](https://typescript-eslint.io/developers/custom-rules/)

**Fork 2:**
- typescript-eslint monorepo (`main`, fetched verbatim):
  [eslint.config.mjs](https://github.com/typescript-eslint/typescript-eslint/blob/main/eslint.config.mjs),
  [tsconfig.json](https://github.com/typescript-eslint/typescript-eslint/blob/main/tsconfig.json),
  [tsconfig.base.json](https://github.com/typescript-eslint/typescript-eslint/blob/main/tsconfig.base.json),
  [tsconfig.build.json](https://github.com/typescript-eslint/typescript-eslint/blob/main/tsconfig.build.json),
  [tsconfig.repo-config-files.json](https://github.com/typescript-eslint/typescript-eslint/blob/main/tsconfig.repo-config-files.json),
  [packages/eslint-plugin tsconfigs](https://github.com/typescript-eslint/typescript-eslint/tree/main/packages/eslint-plugin)
- typescript-eslint docs: [parser / projectService + allowDefaultProject](https://typescript-eslint.io/packages/parser/),
  [typed-linting troubleshooting](https://typescript-eslint.io/troubleshooting/typed-linting/),
  [performance](https://typescript-eslint.io/troubleshooting/typed-linting/performance/),
  [monorepos](https://typescript-eslint.io/troubleshooting/typed-linting/monorepos/),
  [Project Service blog](https://typescript-eslint.io/blog/project-service/);
  perf issues [#9474](https://github.com/typescript-eslint/typescript-eslint/issues/9474),
  [#9571](https://github.com/typescript-eslint/typescript-eslint/issues/9571)
- [TS Project References handbook](https://www.typescriptlang.org/docs/handbook/project-references.html)
- [tRPC tsconfig.json](https://github.com/trpc/trpc/blob/main/tsconfig.json) /
  [tsconfig.build.json](https://github.com/trpc/trpc/blob/main/tsconfig.build.json);
  [vitest tsconfig.check.json](https://github.com/vitest-dev/vitest/blob/main/tsconfig.check.json)
- vitest docs: [typecheck config](https://vitest.dev/config/typecheck),
  [testing types](https://vitest.dev/guide/testing-types);
  [@vitest/eslint-plugin](https://github.com/vitest-dev/eslint-plugin-vitest)

**Fork 3:**
- Empirical repro (session scratchpad, repo's own binaries): `no-restricted-paths` +
  `no-restricted-imports` fire in `.svelte` script blocks; `no-cycle` misses `.svelte` edges
- [import-js/eslint-plugin-import#2386](https://github.com/import-js/eslint-plugin-import/issues/2386)
  (svelte integration), [#2837](https://github.com/import-js/eslint-plugin-import/issues/2837)
  (ExportMap re-parse errors; `import/ignore` workaround),
  [#2407](https://github.com/import-js/eslint-plugin-import/issues/2407) (`import/order` fixer
  corruption), [#2556](https://github.com/import-js/eslint-plugin-import/issues/2556) +
  [eslint#16878](https://github.com/eslint/eslint/issues/16878) (flat-config `import/parsers`)
- [eslint-plugin-import-x](https://github.com/un-ts/eslint-plugin-import-x) — README;
  issues [#480](https://github.com/un-ts/eslint-plugin-import-x/issues/480),
  [#308](https://github.com/un-ts/eslint-plugin-import-x/issues/308),
  [#381](https://github.com/un-ts/eslint-plugin-import-x/issues/381)
- [eslint-import-resolver-typescript](https://github.com/import-js/eslint-import-resolver-typescript)
  (default extensions); [eslint-plugin-svelte user guide](https://sveltejs.github.io/eslint-plugin-svelte/user-guide/)
- [eslint-plugin-boundaries#426](https://github.com/javierbrea/eslint-plugin-boundaries/issues/426);
  [jsboundaries custom resolvers](https://www.jsboundaries.dev/docs/guides/custom-resolvers/)
- [eslint-plugin-project-structure independent-modules wiki](https://github.com/Igorkowalski94/eslint-plugin-project-structure/wiki/project%E2%80%91structure-%E2%80%8Bindependent%E2%80%91modules);
  [Sheriff docs](https://sheriff.softarc.io/docs/installation)
- [dependency-cruiser FAQ](https://github.com/sverweij/dependency-cruiser/blob/main/doc/faq.md)
  and [releases](https://github.com/sverweij/dependency-cruiser/releases)
- [GraphiteEditor/Graphite eslint.config.js](https://github.com/GraphiteEditor/Graphite/blob/master/frontend/eslint.config.js)
  (production flat-config attestation)

---

*Non-normative.* This document records what the cited sources and the measured trial runs
supported on 2026-08-05 against the versions then pinned (eslint 10.7.0, typescript-eslint
8.65.0, TypeScript 6.0.3, neverthrow 8.2.0). It is research input to an OpenSpec change, not a
decision; the constitution and the change's design doc govern what actually ships, and the
violation counts above will drift with the codebase.
