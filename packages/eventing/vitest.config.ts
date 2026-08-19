import { defineConfig } from 'vitest/config';

// Project config only — coverage (merged, 100%) is owned by the root vitest.config.ts.
export default defineConfig({
  test: {
    name: 'eventing',
    include: ['src/**/*.test.ts'],
  },
});
