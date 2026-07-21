import { sveltekit } from '@sveltejs/kit/vite';
import { defineConfig } from 'vite';

export default defineConfig({
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
