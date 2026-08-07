import { defineConfig } from 'vitest/config';

/**
 * The repo-tooling tier. Isolated from the root `vitest.config.ts` like the contract and E2E tiers:
 * these specs cover the pure helpers behind the scripts that decide and shape a release
 * (`version:prep`'s releasable-commit guard, the CHANGELOG section extractor) and that shape what
 * the mutation gate reports. This tooling is not shipped runtime code — it lives outside `src/` and
 * carries no coverage thresholds of its own; correctness is pinned by these unit tests, and the git
 * orchestration around them is verified by execution.
 *
 * The include reaches the whole `scripts/` tree rather than one subdirectory (it was
 * `scripts/release/**` until `scripts/mutation/` landed). A tier that names one subdirectory means
 * the next script added beside it is tested by nothing while every lane stays green — the same
 * silent erosion `test/boundaries/gate-coverage.test.ts` exists to catch for lint and typecheck.
 */
export default defineConfig({
  test: {
    include: ['scripts/**/*.test.ts'],
  },
});
