import adapter from '@sveltejs/adapter-node';
import { vitePreprocess } from '@sveltejs/vite-plugin-svelte';

/** @type {import('@sveltejs/kit').Config} */
const config = {
  preprocess: vitePreprocess(),
  kit: {
    adapter: adapter(),
    // The product's ONE config surface (`.env`) lives at the monorepo root, but dev/build run
    // with cwd = packages/web. SvelteKit loads `.env` from `kit.env.dir` (its own knob — NOT
    // vite's envDir), which defaults to cwd; point it at the root so `$env/dynamic/private`
    // actually carries the composed config. Without this, every required var reads undefined.
    env: { dir: '../../' },
  },
};

export default config;
