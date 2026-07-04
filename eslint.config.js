import tseslint from 'typescript-eslint';
import importPlugin from 'eslint-plugin-import';
import prettier from 'eslint-config-prettier';

/**
 * The dependency rule (D9): domain <- application <- {adapters, interfaces} <- composition.
 * A layer may import from itself and inner layers only. Encoded as forbidden (target, from)
 * pairs for `import/no-restricted-paths`; a violation fails lint and therefore CI.
 */
const layerBoundaryZones = [
  // domain imports nothing outward — the pure core depends on no other layer.
  { target: './src/domain', from: './src/application' },
  { target: './src/domain', from: './src/adapters' },
  { target: './src/domain', from: './src/interfaces' },
  { target: './src/domain', from: './src/composition' },
  // application depends only on domain.
  { target: './src/application', from: './src/adapters' },
  { target: './src/application', from: './src/interfaces' },
  { target: './src/application', from: './src/composition' },
  // adapters depend on application + domain, never on interfaces or composition.
  { target: './src/adapters', from: './src/interfaces' },
  { target: './src/adapters', from: './src/composition' },
  // interfaces depend on application + domain, never on adapters or composition.
  { target: './src/interfaces', from: './src/adapters' },
  { target: './src/interfaces', from: './src/composition' },
];

export default tseslint.config(
  {
    ignores: ['dist/**', 'coverage/**', 'node_modules/**', '*.config.ts', '*.config.js'],
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
          project: './tsconfig.json',
        },
      },
    },
    rules: {
      'import/no-restricted-paths': ['error', { zones: layerBoundaryZones }],
      '@typescript-eslint/consistent-type-imports': 'error',
      '@typescript-eslint/no-unused-vars': [
        'error',
        { argsIgnorePattern: '^_', varsIgnorePattern: '^_' },
      ],
    },
  },
  {
    // The pure domain performs no logging (D15): it must not import any logger.
    files: ['src/domain/**/*.ts'],
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
