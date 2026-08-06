import fc from 'fast-check';
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  DEFAULT_NUM_RUNS,
  PINNED_SEED,
  assertAsyncProperty,
  assertProperty,
  propertyRun,
} from './property.js';
import type * as PropertyHarness from './property.js';

/**
 * The harness's own guarantees (decider-properties task 1.1). A property tier is only worth having
 * if a violated property actually fails, and only worth having *in CI* if the failure it prints is
 * enough to reproduce it — so both are mechanized here rather than trusted.
 */

/** A property that is false for every `n >= 5`: fast-check will find and shrink to exactly `5`. */
const alwaysBelowFive = fc.property(fc.integer({ min: 0, max: 1000 }), (n) => n < 5);

/** Freshly load `property.js` under the currently stubbed environment. */
async function loadHarness(): Promise<typeof PropertyHarness> {
  vi.resetModules();
  return import('./property.js');
}

describe('the property harness reports failures well enough to reproduce them', () => {
  it('fails the run when the property is false', () => {
    const outcome = fc.check(alwaysBelowFive, propertyRun);

    expect(outcome.failed).toBe(true);
    expect(outcome.counterexample).toEqual([5]); // shrunk to the smallest violation
  });

  it('prints the seed, the counterexample path, and the counterexample itself', () => {
    const failure = (): void => {
      assertProperty(alwaysBelowFive);
    };

    expect(failure).toThrowError(/seed: \d+/);
    expect(failure).toThrowError(/path: "[\d:]*"/);
    expect(failure).toThrowError(/Counterexample: \[5]/);
  });

  it('carries the violated invariant into the thrown message, not only onto the error cause', () => {
    const named = fc.property(fc.constant(0), () => {
      throw new Error('a settled acquisition re-entered an active phase');
    });

    expect(() => {
      assertProperty(named);
    }).toThrowError(/a settled acquisition re-entered an active phase/);
  });

  it('fails an awaiting property just as loudly as a synchronous one', async () => {
    const failing = fc.asyncProperty(fc.integer({ min: 0, max: 1000 }), async (n) => {
      await Promise.resolve();
      return n < 5;
    });

    await expect(assertAsyncProperty(failing)).rejects.toThrowError(/Counterexample: \[5]/);
  });

  it('replays the identical counterexample from the reported seed and path', () => {
    const first = fc.check(alwaysBelowFive, propertyRun);

    const replay = fc.check(alwaysBelowFive, {
      ...propertyRun,
      seed: first.seed,
      path: first.counterexamplePath ?? undefined,
    });

    expect(replay.failed).toBe(true);
    expect(replay.seed).toBe(first.seed);
    expect(replay.counterexample).toEqual(first.counterexample);
    expect(replay.counterexamplePath).toBe(first.counterexamplePath);
  });
});

describe('the property corpus is pinned, so CI cannot flake', () => {
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it('runs the pinned seed and the default budget when nothing is overridden', async () => {
    vi.stubEnv('FC_SEED', undefined);
    vi.stubEnv('FC_NUM_RUNS', undefined);

    const harness = await loadHarness();

    expect(harness.propertyRun.seed).toBe(PINNED_SEED);
    expect(harness.propertyRun.numRuns).toBe(DEFAULT_NUM_RUNS);
  });

  it('lets an investigator re-roll the corpus and widen the sweep from the environment', async () => {
    vi.stubEnv('FC_SEED', '424242');
    vi.stubEnv('FC_NUM_RUNS', '7');

    const harness = await loadHarness();

    expect(harness.propertyRun.seed).toBe(424_242);
    expect(harness.propertyRun.numRuns).toBe(7);
  });

  it('replays a counterexample seed even though fast-check reports them signed', async () => {
    // fast-check's seeds are signed 32-bit integers, so a real counterexample's seed is routinely
    // negative. Refusing it here would silently run the pinned corpus, go green, and tell the
    // investigator their counterexample does not reproduce.
    vi.stubEnv('FC_SEED', '-1232878318');

    const harness = await loadHarness();

    expect(harness.propertyRun.seed).toBe(-1_232_878_318);
  });

  it('treats a blank value as absent and keeps the pinned corpus', async () => {
    vi.stubEnv('FC_SEED', ' '.repeat(3));
    vi.stubEnv('FC_NUM_RUNS', ' '.repeat(3));

    const harness = await loadHarness();

    expect(harness.propertyRun.seed).toBe(PINNED_SEED);
    expect(harness.propertyRun.numRuns).toBe(DEFAULT_NUM_RUNS);
  });

  it.each([
    ['a non-number', 'lots'],
    ['a fraction', '1.5'],
    ['an underscored numeral the shell did not strip', '10_000'],
  ])('refuses %s loudly rather than pretending it was never set', async (_label, raw) => {
    // A knob that silently does nothing is worse than one that is missing: a nightly configured to
    // widen the sweep would otherwise run the gate's budget and report green.
    vi.stubEnv('FC_NUM_RUNS', raw);

    await expect(loadHarness()).rejects.toThrowError(/FC_NUM_RUNS must be an integer/);
  });

  it.each([
    ['zero', '0'],
    ['a negative count', '-3'],
  ])('refuses %s runs — a sweep that cannot run is a misconfiguration', async (_label, raw) => {
    vi.stubEnv('FC_NUM_RUNS', raw);

    await expect(loadHarness()).rejects.toThrowError(/FC_NUM_RUNS must be an integer >= 1/);
  });
});
