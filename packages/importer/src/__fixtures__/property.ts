import fc from 'fast-check';

/**
 * The property tier's run configuration — the one place this package's seed and run count are set.
 *
 * Test support, not production code: it lives under `__fixtures__` so it stays outside the build
 * (`tsconfig.build.json`) and outside the 100% coverage denominator (root `vitest.config.ts`),
 * exactly like every other builder beside it.
 *
 * **The seed is pinned** so CI is deterministic *by construction*: the same 100 cases run on every
 * commit, and a new counterexample can only ever enter through a code or generator change — never
 * through a lucky draw. That is the whole answer to property-based testing's flaky-CI reputation
 * (decider-properties design D3). Two escape hatches keep exploration possible without unpinning
 * the gate:
 *
 * - `FC_SEED=<n>` — run a different corpus locally (or replay a reported counterexample's seed).
 * - `FC_NUM_RUNS=<n>` — widen the sweep (a nightly or an investigation) beyond the gate's budget.
 *
 * Reading them here is not a domain-purity violation: this module is test configuration at the
 * package edge, imported only by `*.property.test.ts` files, and the twelve-factor rule it follows
 * is the one that says knobs come from the environment.
 *
 * Twinned in the other bounded context's package. The two contexts never import each other (the
 * module boundary is lint-enforced), so this harness is duplicated exactly as their event stores,
 * fakes and shared value objects already are — a shared copy would be a shared kernel.
 */

/**
 * The pinned corpus. Any 32-bit integer would do; this one is the date the property tier was
 * adopted. Changing it re-rolls every property's 100 cases — a deliberate act (a fresh sweep),
 * never a drive-by edit.
 */
export const PINNED_SEED = 20_260_806;

/** The gate's budget per property: fast-check's default, kept inside the seconds-order `pnpm check`. */
export const DEFAULT_NUM_RUNS = 100;

/** A positive-integer environment override, ignoring anything that is not one. */
function positiveIntFromEnvironment(name: string, fallback: number): number {
  const raw = process.env[name];
  if (raw === undefined || raw.trim() === '') return fallback;
  const parsed = Number(raw);
  return Number.isSafeInteger(parsed) && parsed > 0 ? parsed : fallback;
}

/**
 * The options every property in this package runs under. Structurally a `fc.Parameters<Ts>` for any
 * `Ts`, so it passes straight to `fc.assert`, `fc.check`, and `@fast-check/vitest`'s `test.prop`.
 */
export interface PropertyRunOptions {
  readonly seed: number;
  readonly numRuns: number;
  /**
   * Put the failing assertion's own error *in the thrown message* rather than only on `cause`.
   * Vitest prints the message, so this is what carries the violated-invariant text — alongside
   * fast-check's own seed / counterexample path / shrunk counterexample — into the CI log, where
   * someone reading a failed run can replay it without reproducing anything locally first.
   */
  readonly includeErrorInReport: boolean;
}

export const propertyRun: PropertyRunOptions = {
  seed: positiveIntFromEnvironment('FC_SEED', PINNED_SEED),
  numRuns: positiveIntFromEnvironment('FC_NUM_RUNS', DEFAULT_NUM_RUNS),
  includeErrorInReport: true,
};

/**
 * Assert a property under {@link propertyRun}. A thin alias for `fc.assert` that keeps every
 * property in this package on the pinned corpus — forgetting the options is the one way a property
 * could silently become non-deterministic.
 */
export function assertProperty<Ts extends [unknown, ...unknown[]]>(
  property: fc.IPropertyWithHooks<Ts>,
): void {
  fc.assert(property, propertyRun);
}

/** {@link assertProperty} for a property whose predicate awaits — the store round-trips do. */
export async function assertAsyncProperty<Ts extends [unknown, ...unknown[]]>(
  property: fc.IAsyncPropertyWithHooks<Ts>,
): Promise<void> {
  await fc.assert(property, propertyRun);
}
