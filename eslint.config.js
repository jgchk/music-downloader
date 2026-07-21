import tseslint from 'typescript-eslint';
import importPlugin from 'eslint-plugin-import';
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
  ];
});

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
      '.e2e-tmp/**',
      'test/e2e/**',
      'packages/*/test/contract/**',
      'scripts/**',
      'packages/*/scripts/**',
      '**/*.config.ts',
      '**/*.config.js',
    ],
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
        { zones: [...layerBoundaryZones, ...aggregateEncapsulationZones] },
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
    files: ['**/*.test.ts'],
    rules: {
      '@typescript-eslint/no-non-null-assertion': 'off',
      // vitest mocks are referenced unbound in assertions (expect(fn).toHaveBeen…).
      '@typescript-eslint/unbound-method': 'off',
    },
  },
  prettier,
);
