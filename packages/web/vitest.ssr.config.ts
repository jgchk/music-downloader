import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { svelte } from '@sveltejs/vite-plugin-svelte';
import { defineConfig } from 'vitest/config';

/**
 * The web package's `ssr` project (design D10): render-to-string smokes through `svelte/server` —
 * the exact path the BFF takes before hydration. Node environment; the svelte plugin compiles
 * components server-side.
 */

// Match the build's `__APP_VERSION__` define (design D5) so SSR tests see the shipped version.
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
    name: 'web:ssr',
    environment: 'node',
    include: ['src/**/*.ssr.test.ts'],
    root: fileURLToPath(new URL('.', import.meta.url)),
  },
});
