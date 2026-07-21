import { defineConfig } from 'vitest/config';

/**
 * Root test configuration: one runner over every workspace package's unit/integration suite,
 * with coverage measured as a single merged report against one 100% threshold (release-pipeline:
 * "Coverage is one merged measurement"). Per-package vitest configs define each project's
 * environment; coverage lives here only — vitest evaluates thresholds root-level across projects.
 *
 * The web package contributes three projects (design D10): `web:server` (node), `web:ssr`
 * (node render-to-string), `web:client` (Browser Mode, Chromium — v8 coverage needs a V8
 * runtime). Coverage from all of them merges into this one report.
 */
export default defineConfig({
  test: {
    projects: [
      'packages/downloader',
      'packages/importer',
      'packages/web/vitest.server.config.ts',
      'packages/web/vitest.ssr.config.ts',
      'packages/web/vitest.client.config.ts',
      // Root-level boundary pins: prove the lint-enforced module boundaries stay configured.
      {
        test: {
          name: 'boundaries',
          environment: 'node',
          include: ['test/boundaries/**/*.test.ts'],
        },
      },
    ],
    coverage: {
      provider: 'v8',
      include: ['packages/*/src/**/*.ts', 'packages/web/src/**/*.svelte'],
      exclude: [
        'packages/*/src/**/*.test.ts',
        'packages/*/src/**/index.ts',
        'packages/*/src/**/__fixtures__/**',
        // Named web carve-outs (web-ui spec): infrastructure with no logic of its own.
        'packages/web/src/app.html',
        'packages/web/src/**/*.d.ts',
      ],
      // Re-apply excludes after v8's AST remapping back to original sources — required for
      // compiled .svelte files to be attributed (and excluded) correctly.
      excludeAfterRemap: true,
      thresholds: {
        lines: 100,
        branches: 100,
        functions: 100,
        statements: 100,
      },
    },
  },
});
