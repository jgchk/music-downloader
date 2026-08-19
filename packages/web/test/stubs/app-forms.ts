/**
 * `$app/forms` for the component tiers.
 *
 * SvelteKit's own module is only resolvable through `svelte-kit sync`, which the ssr and client
 * vitest projects deliberately do not run (they compile components with the plain svelte plugin).
 * `enhance` is an action whose whole job is to intercept a submit and re-render the page in place —
 * behaviour that belongs to the framework and the browser, and is exercised by the Playwright tier.
 * Here it is a no-op action, so a component that uses it can still be rendered and asserted.
 */
export function enhance(_form: HTMLFormElement): { destroy: () => void } {
  return { destroy: () => {} };
}
