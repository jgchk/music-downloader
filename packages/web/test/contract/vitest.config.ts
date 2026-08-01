import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vitest/config';

/**
 * The web package's contract test tier (external-api-contracts): the real plex.tv adapter over
 * real HTTP against a local server serving frozen, recorded fixtures — no containers, no network,
 * no coverage measurement (the downloader tier's shape). Gates every commit as its own step; the
 * schema modules it leans on are covered by the unit run.
 */
export default defineConfig({
  // Self-locating: the root gate invokes this config from the workspace root, so anchor the
  // project at this package rather than the invoking cwd.
  root: fileURLToPath(new URL('../..', import.meta.url)),
  test: {
    include: ['test/contract/**/*.contract.test.ts'],
    testTimeout: 20_000,
  },
});
