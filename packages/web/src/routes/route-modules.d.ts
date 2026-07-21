/**
 * SvelteKit reserves `+`-prefixed modules for the router, and svelte-check refuses to resolve
 * them from test importers. Tests still need to render route components to keep them inside the
 * 100% coverage gate, so declare them as Svelte components here — vitest compiles the real file;
 * this declaration only satisfies the type program. Keep route files thin wrappers over typed
 * `$lib` components so the loose typing here never hides a real contract.
 */
declare module '*/+page.svelte' {
  import type { Component } from 'svelte';
  const component: Component;
  export default component;
}
declare module '*/+layout.svelte' {
  import type { Component } from 'svelte';
  const component: Component;
  export default component;
}
