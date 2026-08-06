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
 * - `FC_SEED=<n>` — run a different corpus locally, or replay a reported counterexample's seed
 *   (fast-check's seeds are signed, so `n` may be negative).
 * - `FC_NUM_RUNS=<n>` — widen the sweep (a nightly or an investigation) beyond the gate's budget.
 *
 * Both refuse a malformed value loudly rather than falling back to the default: a knob that
 * silently does nothing is worse than one that is missing.
 *
 * Reading them here is not a domain-purity violation: this module is test configuration at the
 * package edge, imported only by `*.property.test.ts` files, and the twelve-factor rule it follows
 * is the one that says knobs come from the environment.
 *
 * Twinned in the other bounded context's package, and deliberately so — but not because sharing it
 * would be a shared kernel: this file holds a seed, a run count and two `fc.assert` wrappers, zero
 * domain concepts, and the repo already shares eslint/vitest/tsconfig without anyone calling those
 * a kernel. The honest reasons are smaller: there is no dev-only test-support package to put it in
 * (`packages/*` is the two contexts plus web), it is under a hundred lines, and an independent
 * `PINNED_SEED` per context is a feature — one context can re-roll its corpus without disturbing
 * the other. If the two copies ever need to diverge, they simply can.
 */

/**
 * The pinned corpus. Any 32-bit integer would do; this one is the date the property tier was
 * adopted. Changing it re-rolls every property's 100 cases — a deliberate act (a fresh sweep),
 * never a drive-by edit.
 */
export const PINNED_SEED = 20_260_806;

/** The gate's budget per property: fast-check's default, kept inside the seconds-order `pnpm check`. */
export const DEFAULT_NUM_RUNS = 100;

/**
 * An integer override read from the environment.
 *
 * Absent means "use the pinned default". **Present-but-unusable is a hard failure, never a silent
 * fallback** — a nightly configured with `FC_NUM_RUNS=10_000` (a plausible typo in a repo that
 * writes `20_260_806` two lines up) would otherwise run the gate's 100 cases and report green,
 * making the misconfiguration invisible in exactly the run that was supposed to widen the sweep.
 * Failing fast on malformed config is the twelve-factor rule; a throw at module load is how a test
 * fixture expresses it, since there is no Result channel to thread through an import.
 */
function integerFromEnvironment(name: string, fallback: number, minimum: number): number {
  const raw = process.env[name];
  if (raw === undefined || raw.trim() === '') return fallback;
  const parsed = Number(raw);
  if (!Number.isSafeInteger(parsed) || parsed < minimum) {
    throw new Error(
      `${name} must be an integer >= ${String(minimum)}; got ${JSON.stringify(raw)}. ` +
        'Leave it unset to use the pinned corpus.',
    );
  }
  return parsed;
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
  // fast-check reports seeds as SIGNED 32-bit integers, so a counterexample's seed is routinely
  // negative. Refusing negatives here would silently run the pinned corpus instead of the reported
  // one, go green, and tell the investigator the counterexample does not reproduce.
  seed: integerFromEnvironment('FC_SEED', PINNED_SEED, Number.MIN_SAFE_INTEGER),
  numRuns: integerFromEnvironment('FC_NUM_RUNS', DEFAULT_NUM_RUNS, 1),
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
