import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vitest/config';

/**
 * The contract test tier (change: external-api-contract-tests). Isolated from the root
 * `vitest.config.ts` and the E2E tier: these specs exercise the real slskd/MusicBrainz adapters
 * over real HTTP against a local server serving frozen, recorded fixtures — no containers, no
 * network, no coverage measurement. They gate every commit as their own step. The `src/` schema
 * modules they lean on are covered by the unit run; this tier verifies wire behaviour and fixture
 * fidelity, so it deliberately carries no coverage thresholds of its own.
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
