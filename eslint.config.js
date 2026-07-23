import tseslint from 'typescript-eslint';
import importPlugin from 'eslint-plugin-import';
import svelte from 'eslint-plugin-svelte';
import unicorn from 'eslint-plugin-unicorn';
import prettier from 'eslint-config-prettier';

const modulePackages = ['downloader', 'importer'];

/**
 * The dependency rule (D9): domain <- application <- {adapters, interfaces} <- composition.
 * A layer may import from itself and inner layers only, within each bounded-context package.
 * Encoded as forbidden (target, from) pairs for `import/no-restricted-paths`; a violation fails
 * lint and therefore CI.
 */
const layerBoundaryZones = modulePackages.flatMap((pkg) => {
  const src = `./packages/${pkg}/src`;
  return [
    // domain imports nothing outward — the pure core depends on no other layer.
    { target: `${src}/domain`, from: `${src}/application` },
    { target: `${src}/domain`, from: `${src}/adapters` },
    { target: `${src}/domain`, from: `${src}/interfaces` },
    { target: `${src}/domain`, from: `${src}/composition` },
    // application depends only on domain.
    { target: `${src}/application`, from: `${src}/adapters` },
    { target: `${src}/application`, from: `${src}/interfaces` },
    { target: `${src}/application`, from: `${src}/composition` },
    // adapters depend on application + domain, never on interfaces or composition.
    { target: `${src}/adapters`, from: `${src}/interfaces` },
    { target: `${src}/adapters`, from: `${src}/composition` },
    // interfaces depend on application + domain, never on adapters or composition.
    { target: `${src}/interfaces`, from: `${src}/adapters` },
    { target: `${src}/interfaces`, from: `${src}/composition` },
    // the facade sits above application + domain only; inner layers never reach outward to it,
    // and the facade never reaches adapters, interfaces, or composition.
    { target: `${src}/domain`, from: `${src}/facade` },
    { target: `${src}/application`, from: `${src}/facade` },
    { target: `${src}/adapters`, from: `${src}/facade` },
    { target: `${src}/facade`, from: `${src}/adapters` },
    { target: `${src}/facade`, from: `${src}/interfaces` },
    { target: `${src}/facade`, from: `${src}/composition` },
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
  ...modulePackages.flatMap((pkg) => [
    {
      // The web package sees a module only through its facade — plus the designated runtime
      // entry, which a files-scoped no-restricted-imports below confines to $lib/server (the
      // composed process's composition seam, design D8).
      target: './packages/web',
      from: `./packages/${pkg}/src`,
      except: ['./facade', './composition/runtime.ts'],
      message: `Interface packages import a module only via its facade (@music/${pkg}).`,
    },
  ]),
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
  const src = `./packages/${pkg}/src`;
  const internals = [
    `${src}/domain/${dir}/state.ts`,
    `${src}/domain/${dir}/decide.ts`,
    `${src}/domain/${dir}/react.ts`,
  ];
  const externalConsumers = [
    `${src}/application`,
    `${src}/adapters`,
    `${src}/interfaces`,
    `${src}/composition`,
  ];
  return externalConsumers.flatMap((target) =>
    internals.map((from) => ({ target, from, message })),
  );
});

export default tseslint.config(
  {
    // test/e2e, packages/*/test/contract, and scripts (release + contract generators) are
    // out-of-src suites verified by execution (Docker-driven e2e; frozen-fixture contract tests;
    // version:prep unit tests), not part of the src-scoped TypeScript projects (tsconfig
    // `include: ["src"]`); keep them out of the type-checked lint to avoid projectService
    // "file not in project" errors. Their production dependency — the schema modules — lives in
    // src and is fully linted and typechecked there.
    ignores: [
      '**/dist/**',
      '**/coverage/**',
      '**/node_modules/**',
      '**/.svelte-kit/**',
      'packages/web/build/**',
      'packages/web/tests/**',
      'packages/web/playwright.config.ts',
      '.e2e-tmp/**',
      'test/e2e/**',
      'test/boundaries/**',
      'packages/*/test/contract/**',
      'scripts/**',
      'packages/*/scripts/**',
      '**/*.config.ts',
      '**/*.config.js',
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
    files: ['**/*.test.ts', '**/*.svelte'],
    rules: {
      'unicorn/no-top-level-assignment-in-function': 'off',
    },
  },
  {
    // Test suites keep their fixture-builder helpers (`const hit = (over) => ({ … })`) inside the
    // `describe` block that uses them — locality next to the assertions they serve reads better than
    // hoisting every closure-free helper to module scope. The rule stays on for production code,
    // where a function that closes over nothing usually does belong at the outer scope.
    files: ['**/*.test.ts'],
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
    extends: [...tseslint.configs.recommendedTypeChecked],
    languageOptions: {
      parserOptions: {
        projectService: true,
        tsconfigRootDir: import.meta.dirname,
      },
    },
    plugins: {
      import: importPlugin,
    },
    settings: {
      'import/resolver': {
        typescript: {
          project: ['packages/*/tsconfig.json'],
        },
      },
    },
    rules: {
      'import/no-restricted-paths': [
        'error',
        { zones: [...layerBoundaryZones, ...moduleBoundaryZones, ...aggregateEncapsulationZones] },
      ],
      '@typescript-eslint/consistent-type-imports': 'error',
      '@typescript-eslint/no-unused-vars': [
        'error',
        { argsIgnorePattern: '^_', varsIgnorePattern: '^_' },
      ],
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
    // type-aware — type safety for .svelte comes from svelte-check in the typecheck step.
    files: ['**/*.svelte'],
    extends: [...svelte.configs['flat/recommended']],
    languageOptions: {
      parserOptions: {
        parser: tseslint.parser,
      },
    },
    rules: {
      // The app serves at the root (no configured base path), and $lib components stay free of
      // kit-runtime imports so the three-tier component tests can compile them without a kit
      // context; plain string hrefs are correct here.
      'svelte/no-navigation-without-resolve': 'off',
    },
  },
  {
    files: ['**/*.test.ts'],
    rules: {
      '@typescript-eslint/no-non-null-assertion': 'off',
      // vitest mocks are referenced unbound in assertions (expect(fn).toHaveBeen…).
      '@typescript-eslint/unbound-method': 'off',
    },
  },
  prettier,
);
