import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { svelte } from '@sveltejs/vite-plugin-svelte';
import { playwright } from '@vitest/browser-playwright';
import { defineConfig } from 'vitest/config';

/**
 * The web package's `client` project (design D10): component tests in a real headless Chromium via
 * Browser Mode + vitest-browser-svelte locators. Chromium only — v8 coverage requires a V8
 * runtime; cross-browser confidence belongs to the Playwright e2e tier, not the coverage gate.
 */

// Match the build's `__APP_VERSION__` define (design D5) so client tests see the shipped version.
const appVersion = (
  JSON.parse(
    readFileSync(fileURLToPath(new URL('../../package.json', import.meta.url)), 'utf8'),
  ) as { version: string }
).version;

export default defineConfig({
  define: { __APP_VERSION__: JSON.stringify(appVersion) },
  plugins: [svelte()],
  resolve: {
    alias: { $lib: fileURLToPath(new URL('./src/lib', import.meta.url)) },
  },
  test: {
    name: 'web:client',
    include: ['src/**/*.svelte.test.ts'],
    root: fileURLToPath(new URL('.', import.meta.url)),
    browser: {
      enabled: true,
      provider: playwright(),
      headless: true,
      screenshotFailures: false,
      instances: [{ browser: 'chromium' }],
    },
  },
});
