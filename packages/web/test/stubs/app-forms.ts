/**
 * `$app/forms` for the component tiers.
 *
 * SvelteKit's own module is only resolvable through `svelte-kit sync`, which the ssr and client
 * vitest projects deliberately do not run (they compile components with the plain svelte plugin).
 *
 * This stands in for the half of `enhance` that belongs to the component: it intercepts the submit
 * and runs the caller's own callback, including the async part it returns, so a component's
 * submitting state is exercised exactly as it is in production. What it does NOT stand in for is
 * the half that belongs to the framework — posting the form, and applying the action's result — so
 * a test here can assert what the page does WHILE a request is in flight, and the Playwright tier
 * is what proves the round trip.
 */

/**
 * A round trip a test holds open, so what the page does WHILE a request is in flight can be
 * asserted at all. Without it the stub's update resolves before an assertion can run, and the
 * in-flight state would be untestable rather than merely brief.
 */
let held: Promise<void> | undefined;

export function holdSubmissions(): { release: () => void } {
  const { promise, resolve } = Promise.withResolvers<void>();
  held = promise;
  return {
    release: () => {
      held = undefined;
      resolve();
    },
  };
}

interface UpdateOptions {
  reset: boolean;
}
type SubmitResult = (event: { update: (options: UpdateOptions) => Promise<void> }) => Promise<void>;
type SubmitFunction = (event: { formData: FormData }) => SubmitResult | void;

export function enhance(form: HTMLFormElement, submit?: SubmitFunction): { destroy: () => void } {
  const onSubmit = (event: Event): void => {
    event.preventDefault();
    const result = submit?.({ formData: new FormData(form) });
    // The framework would post the form here; the stub resolves the update immediately — or when
    // a test releases it, so the in-flight state has a moment long enough to be seen.
    void result?.({ update: () => held ?? Promise.resolve() });
  };
  form.addEventListener('submit', onSubmit);
  return { destroy: () => form.removeEventListener('submit', onSubmit) };
}
