import { sveltekit } from '@sveltejs/kit/vite';
import { defineConfig } from 'vite';

export default defineConfig({
  plugins: [sveltekit()],
  ssr: {
    // The module packages export TypeScript source (facade + runtime entries); compile them into
    // the server bundle rather than externalizing them. Their native/runtime deps (better-sqlite3,
    // pino, …) remain external as usual.
    noExternal: ['@music/downloader', '@music/importer'],
  },
});
