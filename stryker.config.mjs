// The mutation gate's configuration (change: mutation-gate; capability: mutation-testing).
//
// Line coverage proves every line *executes* under test. It does not prove any test would *notice*
// the line going wrong — and in this repo the tests are written by the same process that writes the
// code, so coverage is the one axis where the gate grades its own homework. Mutation testing is the
// instrument that measures detection instead of execution.
//
// The deployment follows the Google recipe (ICSE-SEIP 2018 / TSE 2021, via
// `docs/research/automated-quality-function.md`): mutate changed code at review time, suppress arid
// nodes, surface at most one mutant per line. Two deliberate deviations: scope is the changed FILES
// rather than changed lines (the PR job explains why), and surfacing is not advisory — see
// `openspec/changes/mutation-gate/design.md` D2:
// this factory has no human reviewer to absorb advisory noise with a shrug, and an advisory finding
// with no consumer is the attested-dead nightly-batch shape. So the PR job is written to block —
// but see the note on the job itself: until the seeding burn-down closes (task 2.1) the step runs
// `continue-on-error` and the check is NOT required, because main is not yet mutant-clean.
//
// SCOPE — both bounded-context packages AND the shared mechanism package
// (`packages/eventing`), every layer, adapters included: a mutant surviving an
// adapter's error mapping is precisely the tolerant-reader assertion gap the contract tier was
// supposed to catch, so adapters are not a lesser tier here.
//
// `packages/eventing` carries the seam's delivery and correlation mechanism, which both
// contexts now depend on: a mutant surviving there survives for both of them at once, so it
// is the last tree that may sit outside the gate.
//
// `packages/web` is EXCLUDED, and named rather than omitted. StrykerJS cannot instrument `.svelte`,
// so including the package would mutate only its TypeScript BFF fragments while presenting as full
// coverage of the UI — a partial gate that reads as a whole one is worse than a named exclusion.
// This is a tracked DEFERRED item, not a permanent carve-out: web joins mutation scope when
// `.svelte` instrumentation exists, or when a BFF-only scope is accepted explicitly (tasks 4.2 /
// design D3). `test/boundaries/mutation-scope.test.ts` fails if this exclusion ever goes silent.
//
// Composition roots stay IN scope. The spec forbids excluding a directory of the covered packages:
// wiring is handled by per-site `// Stryker disable next-line <mutator>: <reason>` suppression, so
// non-arid logic hiding in a composition root is still observed. Every suppression carries a
// written justification, held to the same burden as an `any` — the boundaries tier fails on one
// that does not.

/** @type {import('@stryker-mutator/api/core').PartialStrykerOptions} */
export default {
  $schema: './node_modules/@stryker-mutator/core/schema/stryker-schema.json',
  packageManager: 'pnpm',
  testRunner: 'vitest',

  // Named rather than auto-discovered. Under pnpm's symlinked layout Stryker's plugin discovery
  // does not resolve the runner; observed as the run dying with "Cannot find TestRunner plugin
  // 'vitest'. In fact, no TestRunner plugins were loaded." Naming them is deterministic anyway.
  plugins: ['@stryker-mutator/vitest-runner', './scripts/mutation/ignore-logging.mjs'],

  // The one arid family this repo configures rather than suppresses site-by-site: log statements.
  // The plugin's own header argues the case and bounds the rule; the short version is that the
  // domain does not log at all and elsewhere a log call's arguments reach a transport and nothing
  // else, so no mutant inside one is killable by a test of behavior. It retired 253 mutants, ~200 of
  // them survivors of run 2's 807, and the waiver doctrine asks for one configured decision carrying
  // its reason rather than a suppression comment on each of the 121 log call sites that produce them.
  ignorers: ['arid-logging'],

  // The mutation-only suite: the two context packages' co-located unit tests AND their contract
  // tiers (that inclusion is load-bearing — `vitest.mutation.config.ts` argues it), no web projects.
  vitest: { configFile: 'vitest.mutation.config.ts' },

  // Production TypeScript in both context packages. The only negations are non-production code —
  // test files and the in-`src` fixture builders — and `mutation-scope.test.ts` pins that allowlist
  // exactly, so a third exclusion cannot be added without arguing for it.
  mutate: [
    'packages/downloader/src/**/*.ts',
    'packages/eventing/src/**/*.ts',
    'packages/importer/src/**/*.ts',
    '!packages/*/src/**/*.test.ts',
    '!packages/*/src/**/__fixtures__/**',
  ],

  // Stryker copies the project into a sandbox before mutating, and it does NOT read `.gitignore` —
  // its built-in ignore list is only `node_modules`, `.git`, `*.tsbuildinfo`, `stryker.log` and a
  // few framework directories. Without these entries the copy walks the Python bridge's virtualenv
  // and dies on its `lib64` symlink (`EISDIR: illegal operation on a directory, copyfile`), so
  // `pnpm test:mutation` breaks for anyone who has run `pnpm check` even once — the venv is created
  // by the `bridge` lane. Everything listed here is generated output that no mutant can live in.
  ignorePatterns: [
    // A Stryker run ignores only the sandbox of the run in flight — its own CONFIGURED
    // `tempDirName`, which defaults to `.stryker-tmp` (measured against 9.6.1: the prune list is
    // built from `tempDirName`, not from the default name). So the default is NOT automatically
    // safe: a run given `--tempDirName` (which is how two scoped runs avoid corrupting each other's
    // sandbox, e.g. when triaging several files at once) copies every OTHER spelling into its own,
    // the default included, and they nest:
    // `.stryker-tmp-a/sandbox-x/.stryker-tmp-b/sandbox-y/…`. It does not fail loudly — it reports a
    // plausible WRONG score (73 survivors in a file that has none) and only then dies on `ENOENT`
    // for files inside a path it had just built. The glob covers every spelling, so the rule holds
    // however the directory is named.
    '**/.stryker-tmp*/',
    '**/.venv/',
    'coverage',
    '.e2e-tmp',
    'reports',
    'packages/*/dist',
    'packages/web/build',
    'packages/web/test-results',
    'packages/web/playwright-report',
  ],

  // Run only the tests that cover a mutant. This is what makes a full run finish at all.
  coverageAnalysis: 'perTest',

  // Static mutants — those whose code runs only while a module is being loaded — are REJECTED as a
  // class, at the config site, with their reason (the waiver doctrine's required shape). This is a
  // rule-pack rejection under the admission contract, not a convenience.
  //
  // The evidence, measured on this repo during adoption: the seeding run reported 160 surviving
  // static mutants. Taking one of them — emptying `createMatchPolicy`'s body in
  // `domain/policy/policies.ts` — and applying it by hand fails 27 test files. The suite detects it
  // perfectly well; Stryker could not. The vitest runner activates a mutant through a global read at
  // runtime, but module-level code has already been evaluated by the time that global is set, so a
  // static mutant is never actually exercised and reports as surviving no matter how well tested it
  // is. 160 of run 2's 807 survivors were reported static, and 135 of those vanished outright
  // when this landed — roughly a sixth of the survivor list was the artefact.
  //
  // That fails the admission contract twice over: the findings are false, and their only available
  // "fix" is to stop initialising anything at module scope — contorting real code to satisfy a tool
  // that cannot see it, which is precisely the appeasement the contract exists to prevent.
  //
  // Cost, stated plainly and measured: 565 mutants leave the measurement (NOT all 1078 Stryker
  // flags as static — only those that run *solely* at module load; the other ~513 also execute
  // inside tests and stay measured). The sharpest casualty is the anti-corruption layer: every
  // `adapters/*/schemas.ts` is a top-level `z.object({…})`, so all 65 of their mutants are now
  // ignored and a PR touching only a schema audits nothing. The summary says so out loud rather
  // than reading it as clean. Deferred: revisit if the vitest runner gains per-mutant module
  // reloading — the fix is upstream, not a config we can write.
  ignoreStatic: true,

  // Any surviving non-suppressed mutant fails the run. Expressed as a 100% break threshold because
  // that is the knob Stryker offers, but the *signal* is per-mutant, not a score: score 100 is
  // exactly "zero survivors", and the reporters below name every survivor with file, line, and
  // mutation. A sub-100 threshold would be the drift-prone, Goodhart-shaped thing design D1
  // rejects — a number to be appeased rather than a finding to be killed or justified.
  thresholds: { high: 100, low: 100, break: 100 },

  // Incremental mode is OFF by default and opted into per command — the opposite of what design D4
  // sketched, for a reason found during adoption and recorded in D4a.
  //
  // Stryker's incremental report is whole-repo: it merges cached results for files this run did not
  // mutate into the final report, and the break threshold then applies to that merged whole. In the
  // PR job that turns a diff gate back into a repo gate — a branch would fail on surviving mutants
  // in files it never touched, which is exactly the pre-existing-debt blocking that D5's ordering
  // exists to prevent. The PR job therefore scopes by `--mutate <changed files>` and runs fresh.
  //
  // `pnpm test:mutation` passes `--incremental` explicitly: locally the run IS whole-repo, so
  // reusing the previous verdict is pure win. The weekly full run stays fresh — it is the
  // authoritative inventory, and an authoritative answer built on a cache is not one.
  incremental: false,
  incrementalFile: 'reports/mutation/stryker-incremental.json',

  // `json` is what the CI job parses to write its per-mutant summary; `clear-text` is what a human
  // (or an agent) reads locally. No `html` — nothing in this pipeline serves it.
  reporters: ['clear-text', 'progress', 'json'],
  jsonReporter: { fileName: 'reports/mutation/mutation.json' },
  clearTextReporter: { logTests: false, allowEmojis: false },
};
