import tseslint from 'typescript-eslint';
import importPlugin from 'eslint-plugin-import';
import svelte from 'eslint-plugin-svelte';
import unicorn from 'eslint-plugin-unicorn';
import neverthrow from '@ninoseki/eslint-plugin-neverthrow';
import prettier from 'eslint-config-prettier';
import sonarjs from 'eslint-plugin-sonarjs';

const modulePackages = ['downloader', 'importer'];

/**
 * Test code, wherever it lives: the co-located unit/integration suites plus every out-of-src tier
 * (contract, boundaries, e2e, Playwright) — including the tiers' non-`.test.ts` helpers, fixture
 * builders, and recorders, which are test code by any reading.
 *
 * Every test-code carve-out below is scoped to this list and nothing else. For test code proper
 * the divergence from production is five named rules: `@typescript-eslint/unbound-method`,
 * `unicorn/name-replacements`, `neverthrow/must-use-result`,
 * `unicorn/no-top-level-assignment-in-function` (shared with the Svelte file set), and
 * `unicorn/consistent-function-scoping`.
 *
 * It is NOT that same five everywhere these globs reach, and the CLI entrypoints below split two
 * ways. The ones living inside a package's own `test` tree (the contract recorders and drift
 * checkers) ARE swept in here and then re-armed, so for them `neverthrow/must-use-result` is back
 * to `error` and `unicorn/no-process-exit` is additionally off — a different five. The schema
 * generators under each package's `scripts` tree are matched by no glob in this constant at all,
 * so nothing is re-armed for them and they diverge from production by `unicorn/no-process-exit`
 * alone. (Glob literals are spelled out in the line comments below, never here: a block comment
 * cannot contain a star followed by a slash without closing itself, which is how this paragraph
 * once silently truncated the whole config.)
 *
 * A carve-out that names its own glob instead of this constant is the drift this comment exists to
 * prevent. The production profile is otherwise identical, per module-architecture ("Test tiers
 * SHALL run the production rule profile except for short, named, documented carve-outs").
 *
 * All three sets are derived from the resolved config and compared against these names in
 * `test/boundaries/rule-profile.test.ts` — an enumeration nothing checks is a claim, and this one
 * has been wrong twice: it once counted a rule production never enabled, and it once described
 * every CLI entrypoint as diverging by the same set.
 */
const testFiles = [
  '**/*.test.ts',
  'test/**/*.ts',
  'packages/*/test/**/*.ts',
  'packages/web/tests/**/*.ts',
];

/**
 * The repo's actual command-line programs: the event-schema generators behind
 * `pnpm contracts:events`, and the contract recorders/drift checkers run as `tsx <file>`.
 *
 * The root `scripts` tree is deliberately NOT here. The release tier has zero `process.exit` calls
 * — it uses the better `process.exitCode` idiom, which the rule does not flag — so listing it would
 * have disabled the rule across that whole tree, unit suites included, to no purpose. (No file
 * count is quoted: it moves with every script added and nothing checks it.)
 */
const cliEntrypoints = [
  'packages/*/scripts/**/*.ts',
  'packages/*/test/contract/record/**/*.ts',
  'packages/*/test/contract/drift/**/*.ts',
];

/**
 * The dependency rule (D9): domain <- application <- {adapters, interfaces} <- composition.
 * A layer may import from itself and inner layers only, within each bounded-context package.
 * Encoded as forbidden (target, from) pairs for `import/no-restricted-paths`; a violation fails
 * lint and therefore CI.
 */
const layerBoundaryZones = modulePackages.flatMap((package_) => {
  const source = `./packages/${package_}/src`;
  return [
    // domain imports nothing outward — the pure core depends on no other layer.
    { target: `${source}/domain`, from: `${source}/application` },
    { target: `${source}/domain`, from: `${source}/adapters` },
    { target: `${source}/domain`, from: `${source}/interfaces` },
    { target: `${source}/domain`, from: `${source}/composition` },
    // application depends only on domain.
    { target: `${source}/application`, from: `${source}/adapters` },
    { target: `${source}/application`, from: `${source}/interfaces` },
    { target: `${source}/application`, from: `${source}/composition` },
    // adapters depend on application + domain, never on interfaces or composition.
    { target: `${source}/adapters`, from: `${source}/interfaces` },
    { target: `${source}/adapters`, from: `${source}/composition` },
    // interfaces depend on application + domain, never on adapters or composition.
    { target: `${source}/interfaces`, from: `${source}/adapters` },
    { target: `${source}/interfaces`, from: `${source}/composition` },
    // the facade sits above application + domain only; inner layers never reach outward to it,
    // and the facade never reaches adapters, interfaces, or composition.
    { target: `${source}/domain`, from: `${source}/facade` },
    { target: `${source}/application`, from: `${source}/facade` },
    { target: `${source}/adapters`, from: `${source}/facade` },
    { target: `${source}/facade`, from: `${source}/adapters` },
    { target: `${source}/facade`, from: `${source}/interfaces` },
    { target: `${source}/facade`, from: `${source}/composition` },
  ];
});

/**
 * Module boundaries (module-architecture): the two bounded contexts never import each other, and
 * interface packages (web) reach a module only through its facade entry point. A violation fails
 * lint and therefore CI.
 */
const moduleBoundaryZones = [
  {
    target: './packages/downloader',
    from: './packages/importer',
    message: 'Modules are isolated: downloader must not import importer.',
  },
  {
    target: './packages/importer',
    from: './packages/downloader',
    message: 'Modules are isolated: importer must not import downloader.',
  },
  ...modulePackages.map((package_) => ({
    // The web package sees a module only through its facade — plus the designated runtime entry,
    // which a files-scoped no-restricted-imports below confines to $lib/server (the composed
    // process's composition seam, design D8).
    target: './packages/web',
    from: `./packages/${package_}/src`,
    except: ['./facade', './composition/runtime.ts'],
    message: `Interface packages import a module only via its facade (@music/${package_}).`,
  })),
];

/**
 * Each aggregate's decider internals — the folded state, `decide`, and `react` — are private to
 * the aggregate. Only the aggregate's own domain directory may import them; every other layer
 * goes through the aggregate facade, which re-exports the public types. A violation fails lint
 * and therefore CI.
 */
const aggregates = [
  {
    pkg: 'downloader',
    dir: 'acquisition',
    message:
      'Acquisition decider internals are private to the aggregate — import the Acquisition facade from domain/acquisition/acquisition.js instead.',
  },
  {
    pkg: 'importer',
    dir: 'import',
    message:
      'Import decider internals are private to the aggregate — import the Import facade from domain/import/import.js instead.',
  },
];
const aggregateEncapsulationZones = aggregates.flatMap(({ pkg, dir, message }) => {
  const source = `./packages/${pkg}/src`;
  const internals = [
    `${source}/domain/${dir}/state.ts`,
    `${source}/domain/${dir}/decide.ts`,
    `${source}/domain/${dir}/react.ts`,
  ];
  const externalConsumers = [
    `${source}/application`,
    `${source}/adapters`,
    `${source}/interfaces`,
    `${source}/composition`,
  ];
  return externalConsumers.flatMap((target) =>
    internals.map((from) => ({ target, from, message })),
  );
});

/**
 * Resolver settings shared by the `.ts` and `.svelte` blocks. `.svelte` is added to the node
 * resolver's extensions because Svelte imports carry an explicit `.svelte` suffix and the TypeScript
 * resolver does not claim that extension; SvelteKit's `$lib/*` still resolves through the generated
 * `.svelte-kit/tsconfig.json` on the typescript resolver.
 */
const importSettings = {
  'import/resolver': {
    node: { extensions: ['.js', '.ts', '.mjs', '.cjs', '.svelte'] },
    typescript: { project: ['packages/*/tsconfig.json'] },
  },
};

/**
 * The dependency and module boundaries, enforced identically in `.ts` and inside a `.svelte`
 * `<script lang="ts">` block. `no-restricted-paths` crosses the parser boundary because it only
 * visits the linted file's own `ImportDeclaration`s and resolves their paths — it never re-parses
 * the imported module.
 *
 * LIMITATION worth knowing before reaching for a sibling rule: the ExportMap-family import rules
 * (`no-cycle`, `no-duplicates`, `no-unused-modules`, `no-named-as-default*`) DO re-parse imported
 * modules, and they miss `.svelte` edges *silently* — svelte-eslint-parser nests the imports inside
 * a `SvelteScriptElement`, which ExportMap's top-level walk never sees. Never rely on them for the
 * component graph; if component-graph cycles ever matter, dependency-cruiser is the attested tool
 * (docs/research/result-lint-and-tier-enforcement.md §4.2-4.3).
 */
const restrictedPathsRule = [
  'error',
  { zones: [...layerBoundaryZones, ...moduleBoundaryZones, ...aggregateEncapsulationZones] },
];

export default tseslint.config(
  {
    // Only generated output, third-party trees, and non-TypeScript sources are ignored. Every
    // first-party TS source — package src, scripts, and all four out-of-src test tiers — is linted
    // with the production profile, because every one of them now lives in a tsconfig the project
    // service can find (module-architecture: "Every first-party source tier is inside the lint and
    // typecheck gates"). Adding a tier here again means it must also leave `pnpm typecheck:tiers`.
    ignores: [
      '**/dist/**',
      '**/coverage/**',
      '**/node_modules/**',
      '**/.svelte-kit/**',
      'packages/web/build/**',
      '.e2e-tmp/**',
      // Stryker's sandbox — a whole copy of the tree, so linting it would double every finding —
      // and the mutation reports beside it. Both are `pnpm test:mutation` output, never edited.
      // Wildcarded because `--tempDirName` renames the sandbox (`.stryker-tmp-<name>/`) — see
      // .gitignore, which carries the same glob for the same reason.
      '.stryker-tmp*/**',
      'reports/**',
      // The beets bridge is Python; it has its own native unittest + coverage.py tier.
      'packages/*/test/bridge/**',
      '**/.venv/**',
    ],
  },
  unicorn.configs.recommended,
  {
    // `null` is a first-class value at this codebase's external boundaries, so unicorn/no-null is
    // disabled: better-sqlite3 throws on an `undefined` bind (columns need `null`), the
    // producer-owned event wire contracts model absence as `.nullable().default(null)`, the
    // MusicBrainz reader treats `null` as an incident-hardened "unknown" wire value (schemas.ts),
    // and SvelteKit's own shapes use `null` (`form: null`, `page.error: null`). The pure domain
    // still prefers `undefined`, but scoping that distinction per-file earns less than it costs.
    rules: {
      'unicorn/no-null': 'off',
      // zod schema composition reads fine a few calls deep (`z.array(z.object({ … }))`, which
      // reaches 4 in context); the default of 3 is too strict for a schema-heavy codebase. Bumped
      // to 4 so idiomatic zod passes while genuinely unreadable 5+ deep chains still flag.
      'unicorn/max-nested-calls': ['error', { max: 4 }],
      // This codebase orders class members by *cohesion*, not accessibility: related members sit
      // together — the reactor keeps `dispatchEvent` beside the `process` that calls it, and the
      // catch-up `drain`/`redrive` pair adjacent. Enforcing a strict accessibility order would
      // scatter those groups across a 500-line class, so the rule is off — grouping is the convention.
      'unicorn/consistent-class-member-order': 'off',
    },
  },
  {
    // Two shapes reassign an outer binding from inside a function by design, not by smell: the
    // `let fixture; beforeEach(() => { fixture = … })` vitest setup idiom, and Svelte 5 runes,
    // where assigning a `$state` variable from an effect or handler *is* the reactivity model.
    // Everywhere else the rule stays on (a stray outer-scope assignment is worth a second look —
    // the one production singleton was refactored to a holder object rather than exempted).
    files: [...testFiles, '**/*.svelte'],
    rules: {
      'unicorn/no-top-level-assignment-in-function': 'off',
    },
  },
  {
    // Test suites keep their fixture-builder helpers (`const hit = (over) => ({ … })`) inside the
    // `describe` block that uses them — locality next to the assertions they serve reads better than
    // hoisting every closure-free helper to module scope. The rule stays on for production code,
    // where a function that closes over nothing usually does belong at the outer scope.
    files: testFiles,
    rules: {
      'unicorn/consistent-function-scoping': 'off',
    },
  },
  {
    // Filenames are kebab-case by default, with two carve-outs for established conventions:
    // vitest `__fixtures__` sentinel directories keep their `__name__` form, and…
    rules: {
      'unicorn/filename-case': ['error', { case: 'kebabCase', ignore: [/^__[a-z]+__$/u] }],
    },
  },
  {
    // …Svelte components (and their co-located tests) stay PascalCase, the SvelteKit convention.
    files: ['packages/web/src/lib/components/**'],
    rules: {
      'unicorn/filename-case': ['error', { cases: { kebabCase: true, pascalCase: true } }],
    },
  },
  {
    files: ['**/*.ts'],
    extends: [...tseslint.configs.strictTypeChecked, ...tseslint.configs.stylisticTypeChecked],
    languageOptions: {
      parserOptions: {
        projectService: true,
        tsconfigRootDir: import.meta.dirname,
      },
    },
    plugins: {
      import: importPlugin,
      neverthrow,
      sonarjs,
    },
    settings: importSettings,
    rules: {
      'import/no-restricted-paths': restrictedPathsRule,
      '@typescript-eslint/consistent-type-imports': 'error',
      // The one rule admitted from eslint-plugin-sonarjs. Its `recommended` config carries 279 rule
      // keys but only 217 armed ones — 62 ship as `'off'` in the preset — and that armed set was run
      // repo-wide once and triaged rule-by-rule: 18 rules had findings, 130 in total, and exactly
      // one cleared the admission bar (docs/development/quality-gates.md). That headline —
      // 18 rules with findings, 130 findings, 1 admitted — is recorded HERE because this comment is
      // the durable record; the per-rule reasons live in D3 of the adopting change's design doc
      // (deterministic-floor, archived under openspec/changes/archive/), which is a convenience
      // reference, not the source of truth, precisely because archiving moves its path.
      //
      // Enabling the one admitted rule rather than `recommended`-minus-seventeen is itself an
      // admission-contract call, and the measurement is the argument: the full set cost roughly
      // +16s (~+65%) on cold lint — the gate's longest lane — while this single rule costs about
      // +0.3s (~+1%). The figures are approximate on purpose: two independent runs on the same tree
      // measured +15.7s/+63% and +17.1s/+66%, which is the precision a wall-clock lint benchmark
      // actually has. A rule that is switched off still costs the time to decide it does not apply.
      // This block is also why the plugin survives at all; task 2.4 drops the dependency on a
      // zero-admission run.
      //
      // It lives in the PRODUCTION profile rather than the test-code block even though only test
      // code can trip it (it rewrites `expect(x.length).toBe(n)` into `toHaveLength(n)`,
      // `includes(…)).toBe(true)` into `toContain(…)`, and `toBe(null)` into `toBeNull()` — all
      // three rewrites were applied). Scoping it to the test globs would make it
      // the first rule test code has that production lacks, inverting this config's one-way
      // invariant — tiers run the production profile MINUS named carve-outs — and the rule-profile
      // suite fails on exactly that. Repo-wide it simply never matches outside a test.
      'sonarjs/prefer-specific-assertions': 'error',
      // ── strict-tier carve-outs (deterministic-floor) ──────────────────────────────────────────
      // Three rules the strict tiers arm are rejected under the admission contract
      // (docs/development/quality-gates.md) — note "tiers", plural: `no-empty-function` comes from
      // `stylisticTypeChecked`, the other two from `strictTypeChecked`. They are rejected on TWO
      // different grounds, not one. For `no-invalid-void-type` and `no-empty-function` the findings
      // on THIS repo were reviewed one-by-one and every one was false, so keeping them would teach
      // the loop to appease a rule rather than fix a defect. `no-non-null-assertion` is rejected on
      // a settings CONFLICT instead: some of its findings are real, and it is off anyway because the
      // fix this repo's other settings force is worse than the finding (see its comment below).
      // Tuned options are preferred over disables wherever an option separates the true positives
      // from the false ones.
      //
      // Every `void` finding here was `okAsync<void, E>(undefined)`, `errAsync<void, E>(…)`,
      // `ok<void, E>(…)`, `ResultAsync.fromSafePromise<void>(…)` or `Promise.withResolvers<void>()`
      // — i.e. the repo's errors-as-values core idiom (a command that succeeds with no value) and
      // the standard deferred-promise API. `allowInGenericTypeArguments` (on by default) covers type
      // REFERENCES like `Promise<void>` — which this repo writes constantly — but not explicit type
      // arguments at a CALL site, which is the only shape the rule flags here. 31/31 findings false;
      // no option separates them. Rejected.
      '@typescript-eslint/no-invalid-void-type': 'off',
      // An empty body is how this codebase deliberately says "do nothing", in three sanctioned
      // shapes — and two of the three are PRODUCTION, so this is not a test-only relaxation.
      // (1) `.map(() => {})`, the neverthrow idiom that discards a success value to narrow
      // `ResultAsync<T, E>` to `ResultAsync<void, E>` (both packages' application `use-cases.ts`).
      // (2) The beets bridge's promise-queue tail, `next.then(() => {}, () => {})` (importer
      // adapters/beets/bridge-adapter.ts), where both arms normalize the queue's settled state so
      // the next job runs exactly once on either outcome — neither a `.map` nor a test double.
      // (3) The no-op port method, disposer, or callback on a test double that must implement an
      // interface it does not exercise (`interval: () => () => {}`, `subscribe: () => () => {}`,
      // a silent log destination). All three are intentional; the
      // rule's real quarry — a body someone forgot to write — is indistinguishable from them here.
      // 35/35 findings false. Rejected. (34/34 at triage time; the slskd contract tier landed one
      // more shape-(3) port double before merge.)
      '@typescript-eslint/no-empty-function': 'off',
      // Tuned, not disabled: interpolating a number is unambiguous and ubiquitous here (durations,
      // byte counts, ports, retry rounds — 97 of 108 findings; 90 plain `number`, 6 numeric
      // literals, 1 `number | "by signal"`). The dangerous cases stay armed, which is the point:
      // `${string | undefined}` silently renders "undefined" into a log line, a path, or a URL, and
      // this run found real instances of exactly that. Those are now fixed, so re-running the rule
      // today with `allowNumber: false` reports the 97 numeric ones and nothing else.
      // Every other BOOLEAN allowance is pinned false ON PURPOSE. An options object REPLACES the
      // strict tier's entry rather than merging with it, and this rule's own defaults are permissive
      // (`allowAny`, `allowBoolean`, `allowNullish`, `allowRegExp` all default true) — so writing
      // `{ allowNumber: true }` alone would have quietly re-admitted `any` and nullish
      // interpolation while looking like a one-word relaxation. Naming them keeps the relaxation
      // exactly one type wide.
      // One allowance is NOT pinned and stays in force: the rule's own `defaultOptions` carry
      // `allow: [{ name: ['Error', 'URL', 'URLSearchParams'], from: 'lib' }]`, and typescript-eslint
      // deep-merges defaults under a user options object rather than replacing them, so those three
      // lib types remain interpolable. Deliberate — `${error}` and `${url}` are the shapes their
      // `toString` exists for — but it means "everything else is false" is a claim about the
      // booleans only.
      '@typescript-eslint/restrict-template-expressions': [
        'error',
        {
          allowNumber: true,
          allowAny: false,
          allowBoolean: false,
          allowNullish: false,
          allowRegExp: false,
          allowNever: false,
        },
      ],
      // Tuned, not disabled: `() => clearInterval(handle)` and `(listener) => bus.subscribe(…)`
      // are disposer and adapter shapes where the arrow body IS the effect and the "return" is an
      // artifact of concise syntax. The rule stays armed for the case that actually confuses —
      // an explicit `return voidCall()` in a block body, which reads as if it yields something.
      '@typescript-eslint/no-confusing-void-expression': ['error', { ignoreArrowShorthand: true }],
      // Rejected on a direct conflict with two settings this repo holds MORE strictly than the rule
      // assumes. `noUncheckedIndexedAccess` is on, so every provably-in-bounds array index types as
      // `T | undefined`; coverage thresholds are 100% including branches. Replacing such an index's
      // `!` with a guard or a `?? fallback` therefore adds a branch that cannot execute, which then
      // has to be silenced with a `v8 ignore` — trading a visible, greppable assertion for an
      // invisible coverage waiver, which is strictly worse.
      //
      // COUNTS, stated both ways because the rule is disabled REPO-WIDE while the triage below is
      // production-only. Armed repo-wide it reports 270 findings: 38 in production and 232 in test
      // code, the latter overwhelmingly `arr[0]!` / `mock.calls[0]!` fixture indexing. A reader who
      // re-runs the rule and sees 270 is not seeing a regression; the 38 are the subset that was
      // reviewed one-by-one, and it has stayed 38 across every re-measurement — the repo-wide number
      // tracks test-tier growth, which is why it is not the number the triage rests on.
      // Of those 38, 33 are indices already bounded by their own loop or a
      // length guard (the LCS table in web/src/lib/diff.ts, the duration-pairing loop,
      // `parts.at(-1)` on a `split` result that cannot be empty).
      //
      // The coverage half of that argument is narrower than the whole set and only claims what it
      // covers: 12 of the 38 sit outside the coverage gate altogether — 5 in downloader
      // `src/domain/download/__fixtures__/`, 4 in the two packages' `scripts/` schema generators,
      // 3 in `scripts/release/` — because vitest's coverage `include` is `packages/*/src/**` with
      // `__fixtures__` excluded (vitest.config.ts). A guard at those 12 buys no `v8 ignore`, so they
      // rest on the plainer ground: the assertion is honest and the guard would be unreachable noise.
      //
      // The rule was still worth RUNNING once, and the run is why the rejection is evidence-based
      // rather than assumed. Its five non-index findings are four in the slskd staged-file resolver
      // and one in `scripts/release/bump.ts` — `RELEASABLE_TYPES.has(type!)`, a regex capture-group
      // destructure whose match already proved the group present, not an index at all.
      //
      // The staged-file four are two `transfer.id!` assertions and two `Map.get()!` assertions, and
      // they do not share a reason. The `transfer.id!` pair (staged-files.ts:48 and :58) asserts a
      // wire field the schema declares `.optional()` — traced through, that one is masked (an
      // unresolvable id fails the resolver's own size check) so it degrades diagnosis — a generic
      // "did not report N file(s)" after five pointless re-polls — rather than corrupting data. Left
      // as-is deliberately: naming it accurately means failing fast, which in that adapter means
      // authoring a throw, and converting it to the Result channel is a design change this
      // gate-focused work has no business making. Recorded as a follow-up.
      //
      // The two `Map.get()!` assertions are the opposite case, and they STRENGTHEN the rejection
      // rather than sit under it, because both are provably total. `resolved.get(…)!`
      // (staged-files.ts:58) is only reachable after `resolveStaged` returns, and its sole
      // non-throwing exit is `if (resolved.size === wantedIds.size) return resolved;`
      // (staged-files.ts:113) — every wanted id therefore has a key by construction.
      // `nameByRemote.get(transfer.filename)!` (staged-files.ts:57) cannot miss because
      // `pollOwnedTransfers(…, wanted)` filters transfers to `wanted.has(transfer.filename)`
      // (poll.ts), and `wanted` is built from the same
      // `remoteFilename(candidate.identity.path, file.name)` keys that populate `nameByRemote`
      // (download.ts:169 and staged-files.ts:52). Replacing either with a guard would add a branch
      // no test can reach — which is exactly the trade the first paragraph rejects.
      // A check can earn a one-shot audit without earning a permanent seat in the gate; that
      // distinction is the admission contract's (docs/development/quality-gates.md).
      '@typescript-eslint/no-non-null-assertion': 'off',
      '@typescript-eslint/no-unused-vars': [
        'error',
        { argsIgnorePattern: '^_', varsIgnorePattern: '^_' },
      ],
      // "Never ignore a result" (error-handling.md) made enforceable. Detection is structural: a
      // type counts as Result-like when it carries ALL of map/mapErr/andThen/orElse/match/unwrapOr.
      //
      // The rule's MESSAGE names three ways to handle one ("match, unwrapOr or _unsafeUnwrap") and
      // that message is not the whole story — read the acceptance set, not the message. A Result is
      // accepted, i.e. NOT reported, in any of these seven positions:
      //   1. a handled method is called on it — match, unwrapOr, _unsafeUnwrap — possibly after a
      //      chain of member accesses;
      //   2. it is assigned to a variable and AT LEAST ONE reference to that variable is itself
      //      accepted. Not "every": the check is a `.some(…)`, so a single `if (r.isOk())` licenses
      //      every other bare hand-off of `r` in the same scope. This is the direction that bites —
      //      the rule is LOOSER here than it reads;
      //   3. `isOk()`/`isErr()` is called on such a reference (checked, not handled);
      //   4. it is `yield*`-delegated inside a `safeTry` callback;
      //   5. it is returned — INCLUDING the implicit return of a concise-body arrow;
      //   6. it is an element of an ARRAY LITERAL passed to a call that itself returns a
      //      Result-like. That is the `Result.combine([a, b])` / `ResultAsync.combine([…])` shape,
      //      and it is accepted. (This comment previously claimed combine arguments still flag.
      //      They do not — the rule has a dedicated acceptance path for them.)
      //   7. its parent node is TypeScript syntax. The rule bails on any parent whose AST type
      //      starts with `TS`, so `f() as Whatever`, `f()!`, and `f() satisfies …` are all silently
      //      accepted. A cast or a non-null assertion therefore DISARMS this rule on that
      //      expression — worth knowing before "fixing" a report with one.
      // What still flags is a Result handed to another function in any OTHER argument position, so
      // a deliberate hand-off must make its consumption structural at the call site (see the
      // best-effort ledger thunks for the shape that works).
      //
      // FOUR blind spots, all verified against the pinned plugin — do not read a green lint as
      // proof a Result is consumed:
      // (a) `Promise<Result<T, E>>` is INVISIBLE to the rule. For an `await`, the rule tests the
      //     awaited expression's own type, and a Promise carries none of the marker methods — so
      //     `await sub.reset();` does not report, while `await sub.resetAsync();` (a `ResultAsync`)
      //     does. Any signature that must be rule-enforced has to return `ResultAsync`, not
      //     `Promise<Result<…>>`. Several production signatures are currently in this blind spot.
      // (b) `_unsafeUnwrap` satisfies this rule while violating the errors-as-values ban on unsafe
      //     unwraps in production — silencing the rule that way trades one violation for a worse
      //     one; it is legitimate only in test code, and in the CLI entrypoints carved out below,
      //     where an uncaught throw IS the program's error channel (see that block).
      // (c) Acceptance path 5 above is also a blind spot in the fire-and-forget position:
      //     `setTimeout(() => save(k))` and `p.then(() => save(k))` are NOT caught, because the
      //     concise-body arrow "returns" the Result to a caller that discards it. That position is
      //     exactly where the defects this change fixed lived, so review it by hand.
      // (d) `.svelte` files are NOT covered at all. This block is `files: ['**/*.ts']`, and the
      //     component block below does not host the rule: that block is deliberately not type-aware
      //     (svelte-check does that job), while `must-use-result` needs the type checker to
      //     recognise a Result at all. Not a hard limit — svelte-eslint-parser does support
      //     `projectService` with `extraFileExtensions` — a standing policy choice, so reversing it
      //     is a decision, not a discovery. So a `<script lang="ts">` that discards one is
      //     invisible to lint. The
      //     exposure is small by construction — components consume facades through `locals` and
      //     hold no business rules (design D8) — but it is a hole, not a covered case.
      // The plugin is a small maintained fork (the original died in 2021) pinned exactly; its rule
      // is ~200 lines, its mechanics and upstream source link recorded in
      // docs/research/result-lint-and-tier-enforcement.md — if the fork lapses on an eslint/TS
      // bump, vendor the rule rather than dropping the enforcement.
      'neverthrow/must-use-result': 'error',
      // Defense in depth: `ResultAsync` is a PromiseLike, not a Promise, so the base rule ignores an
      // un-awaited one; `checkThenables` closes that. It cannot replace must-use-result — an
      // awaited-then-discarded Result satisfies it. Note the converse too: because of blind spot
      // (a) above, a discarded `Promise<Result<…>>` that IS awaited is caught by neither rule.
      '@typescript-eslint/no-floating-promises': ['error', { checkThenables: true }],
    },
  },
  {
    // The pure domain performs no logging (D15): it must not import any logger.
    files: ['packages/*/src/domain/**/*.ts'],
    rules: {
      'no-restricted-imports': [
        'error',
        {
          paths: [
            { name: 'pino', message: 'The domain is pure and must not log (D15).' },
            {
              name: 'node:util',
              message: 'The domain is pure and must not perform I/O or logging (D15).',
            },
          ],
          patterns: [
            {
              group: ['**/application/logging', '**/application/logging/*'],
              message: 'The domain is pure and must not import a logger (D15).',
            },
          ],
        },
      ],
    },
  },
  {
    // Outside $lib/server, web code must not touch the module runtime entries — routes and
    // components consume facades via locals only (design D8/D9). $lib/server is the one
    // composition seam allowed to boot the daemon.
    files: ['packages/web/src/**/*.ts', 'packages/web/src/**/*.svelte'],
    ignores: ['packages/web/src/lib/server/**'],
    rules: {
      'no-restricted-imports': [
        'error',
        {
          patterns: [
            {
              group: ['@music/*/runtime'],
              message:
                'Only $lib/server may boot module runtimes; interface code consumes facades via locals (design D8).',
            },
          ],
        },
      ],
    },
  },
  {
    // Svelte components: the plugin's recommended set with TypeScript script blocks. Not
    // type-aware — type safety for .svelte comes from svelte-check in the typecheck step. That is a
    // policy choice, not a parser limit, and its cost is that every type-aware rule is absent here,
    // `neverthrow/must-use-result` included: a `<script lang="ts">` that discards a Result is
    // invisible to lint (blind spot (d) above).
    files: ['**/*.svelte'],
    extends: [...svelte.configs['flat/recommended']],
    languageOptions: {
      parserOptions: {
        parser: tseslint.parser,
      },
    },
    plugins: {
      import: importPlugin,
    },
    settings: importSettings,
    rules: {
      // Components obey the same boundaries as everything else — see restrictedPathsRule.
      'import/no-restricted-paths': restrictedPathsRule,
      // The app serves at the root (no configured base path), and $lib components stay free of
      // kit-runtime imports so the three-tier component tests can compile them without a kit
      // context; plain string hrefs are correct here.
      'svelte/no-navigation-without-resolve': 'off',
    },
  },
  {
    files: testFiles,
    rules: {
      // NB: `@typescript-eslint/no-non-null-assertion` is still deliberately NOT switched off here,
      // and the reason has changed since the profile bump. It used to be absent because
      // `recommendedTypeChecked` never enabled it. `strictTypeChecked` does enable it — but the
      // production block above rejects it repo-wide (see the justification there), so an `'off'`
      // here would once again be dead config diverging from nothing, and would falsely imply that
      // production bans `!`. The rule-profile suite fails on exactly that overclaim.
      // vitest mocks are referenced unbound in assertions (expect(fn).toHaveBeen…).
      '@typescript-eslint/unbound-method': 'off',
      // Test code names things after the vocabulary of the thing under test — a recorded HTTP
      // `res`ponse, a `params` bag, the `err` field of a log line — and unicorn's expansion table
      // would rename those away from the wire shapes they mirror. The rule stays on for production
      // code, where the expansions are unambiguously an improvement.
      'unicorn/name-replacements': 'off',
      // Tests drive Result-returning functions for their effects and assert through other means
      // (the store, a spy, a projection), so the must-use obligation reads as noise here — the
      // production rule is what protects operators. Ratchet trigger: turn this back on (and burn
      // down the backlog) if a test ever passes *because* it silently discarded a failed Result.
      'neverthrow/must-use-result': 'off',
    },
  },
  {
    // `process.exit(1)` with a status code *is* the interface of a command-line program — unicorn's
    // own rule says so ("Only use `process.exit()` in CLI apps"). It stays on everywhere else, where
    // a bare exit would tear down the one process serving both modules and the web UI.
    files: cliEntrypoints,
    rules: {
      'unicorn/no-process-exit': 'off',
      // Re-armed after the test carve-out above, which sweeps these in via `packages/*/test/**`.
      // A recorder or drift checker is a program, not a test: it asserts nothing, so a discarded
      // failed Result there writes a fixture from bad data and the whole tier then replays a lie.
      // Measured cost of holding them to the production profile: zero violations.
      //
      // Against blind spot (b) above, which calls `_unsafeUnwrap` legitimate only in test code:
      // `_unsafeUnwrap` IS the sanctioned consumption HERE, because an uncaught throw is a CLI
      // program's error channel — it aborts the run with a non-zero status before any fixture is
      // written, which is exactly the outcome this re-arm exists to force. What the re-arm bans is
      // the silent path: a failed Result dropped and the run continuing. Do not "fix" a recorder's
      // unwrap into a caught-and-continued branch; that would be the violation, not the unwrap.
      'neverthrow/must-use-result': 'error',
    },
  },
  prettier,
);
