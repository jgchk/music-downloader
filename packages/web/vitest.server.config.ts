import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vitest/config';

/**
 * The web package's `server` project (design D10): plain-node tests for server-side TypeScript —
 * loads, actions, config, pure presentation utils. Svelte compilation is not needed here; the
 * `ssr` and `client` projects own component rendering.
 */
export default defineConfig({
  resolve: {
    alias: { $lib: fileURLToPath(new URL('./src/lib', import.meta.url)) },
  },
  test: {
    name: 'web:server',
    environment: 'node',
    include: ['src/**/*.test.ts'],
    exclude: ['src/**/*.ssr.test.ts', 'src/**/*.svelte.test.ts'],
    root: fileURLToPath(new URL('.', import.meta.url)),
  },
});
