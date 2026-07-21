import { defineConfig } from 'vitest/config';

/**
 * The release-tooling tier. Isolated from the root `vitest.config.ts` like the contract and E2E
 * tiers: these specs cover the pure helpers behind `version:prep` (the releasable-commit guard and
 * the CHANGELOG section extractor) that decide and shape a release. This tooling is not shipped
 * runtime code — it lives outside `src/` and carries no coverage thresholds of its own; correctness
 * is pinned by these unit tests, and the git orchestration around them is verified by execution.
 */
export default defineConfig({
  test: {
    include: ['scripts/release/**/*.test.ts'],
  },
});
