import { defineConfig } from 'vitest/config';

/**
 * The out-of-process E2E tier (change: add-out-of-process-e2e). Deliberately SEPARATE from the
 * root `vitest.config.ts`: these specs drive a real running container over HTTP and must never be
 * part of the unit run or its 100% coverage measurement. No coverage, generous timeouts, no
 * file parallelism (one shared app instance).
 */
export default defineConfig({
  test: {
    include: ['test/e2e/**/*.e2e.test.ts'],
    // A backstop, not a pace-setter: every wait in this tier is a polling probe carrying its own
    // tighter deadline and diagnostic message (the longest single probe budgets 180s, and one
    // test chains several). The ceiling must outlast the longest chain so a failure is always
    // the probe's named timeout — never vitest's opaque "test timed out".
    testTimeout: 600_000,
    hookTimeout: 180_000,
    fileParallelism: false,
  },
});
