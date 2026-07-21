import { defineConfig } from '@playwright/test';

/**
 * The Playwright e2e tier (design D10): a separate, threshold-free job — NOT part of `pnpm check`
 * or the coverage gate. It builds and previews the real app and drives it as a user would;
 * cross-browser confidence lives here, the 100% coverage gate lives in the vitest tiers.
 */
export default defineConfig({
  testDir: './tests',
  webServer: {
    command: 'bash tests/serve.sh',
    port: 4173,
    reuseExistingServer: !process.env.CI,
    timeout: 180_000,
  },
  use: {
    baseURL: 'http://localhost:4173',
  },
});
