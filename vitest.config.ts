import { defineConfig } from 'vitest/config';

/**
 * Root test configuration: one runner over every workspace package's unit/integration suite,
 * with coverage measured as a single merged report against one 100% threshold (release-pipeline:
 * "Coverage is one merged measurement"). Per-package vitest configs define each project's
 * environment; coverage lives here only — vitest evaluates thresholds root-level across projects.
 */
export default defineConfig({
  test: {
    projects: ['packages/*'],
    coverage: {
      provider: 'v8',
      include: ['packages/*/src/**/*.ts'],
      exclude: [
        'packages/*/src/**/*.test.ts',
        'packages/*/src/**/index.ts',
        'packages/*/src/**/__fixtures__/**',
      ],
      thresholds: {
        lines: 100,
        branches: 100,
        functions: 100,
        statements: 100,
      },
    },
  },
});
