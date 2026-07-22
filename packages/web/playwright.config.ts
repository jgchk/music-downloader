import { defineConfig } from '@playwright/test';

/**
 * The Playwright parity smoke — threshold-free in both modes (the coverage gate lives in the
 * vitest tiers). Two ways to run it:
 *
 * - CI (E2E_BASE_URL set, non-empty): a phase of the out-of-process e2e tier. `test/e2e/run.sh`
 *   owns the app — the real built Docker image on a real socket — and points this suite at it;
 *   no webServer here.
 * - Local (E2E_BASE_URL unset or empty): a dockerless developer convenience that builds and
 *   boots the adapter-node app via tests/serve.sh. Not a CI gate.
 */
const harnessUrl = process.env.E2E_BASE_URL;

export default defineConfig({
  testDir: './tests',
  // This suite gates image publish in CI: a stray `.only` must fail loudly, not shrink the gate.
  forbidOnly: !!process.env.CI,
  use: {
    baseURL: harnessUrl || 'http://localhost:4173',
    trace: 'retain-on-failure',
  },
  ...(harnessUrl
    ? {}
    : {
        webServer: {
          command: 'bash tests/serve.sh',
          port: 4173,
          reuseExistingServer: !process.env.CI,
          timeout: 180_000,
        },
      }),
});
