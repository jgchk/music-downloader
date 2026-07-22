import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { sveltekit } from '@sveltejs/kit/vite';
import { defineConfig } from 'vite';

// The shipped product version (design D5): read from the workspace root package.json at config-eval
// time and inlined into the server bundle as `__APP_VERSION__` — the artifact's own version, not an
// environment variable. The three vitest projects declare the same define so tests see the value.
const appVersion = (
  JSON.parse(
    readFileSync(fileURLToPath(new URL('../../package.json', import.meta.url)), 'utf8'),
  ) as { version: string }
).version;

export default defineConfig({
  define: { __APP_VERSION__: JSON.stringify(appVersion) },
  plugins: [sveltekit()],
  ssr: {
    // The module packages export TypeScript source (facade + runtime entries); compile them into
    // the server bundle rather than externalizing them. Their native/runtime deps (better-sqlite3,
    // pino, …) remain external as usual.
    noExternal: ['@music/downloader', '@music/importer'],
    // …but their native/bindings-based deps must NOT be inlined: better-sqlite3's loader walks
    // `__filename` stack frames and breaks inside an ESM bundle. Not in the web package.json, so
    // Vite would otherwise bundle them along with the workspace sources.
    external: ['better-sqlite3', 'pino'],
  },
});
