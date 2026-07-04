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
    testTimeout: 90_000,
    hookTimeout: 90_000,
    fileParallelism: false,
  },
});
