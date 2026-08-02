import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { intervalFreshness, startLiveness, type FreshnessDriver } from './freshness.js';

describe('intervalFreshness — the swappable refresh trigger', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('ticks on the interval until stopped', () => {
    const ticks = vi.fn();
    const stop = intervalFreshness(5000).start(ticks);

    vi.advanceTimersByTime(15_000);
    expect(ticks).toHaveBeenCalledTimes(3);

    stop();
    vi.advanceTimersByTime(15_000);
    expect(ticks).toHaveBeenCalledTimes(3);
  });

  it('does not tick before the first interval elapses', () => {
    const ticks = vi.fn();
    const stop = intervalFreshness(5000).start(ticks);

    vi.advanceTimersByTime(4999);
    expect(ticks).not.toHaveBeenCalled();
    stop();
  });

  it('stopping twice is a no-op', () => {
    const ticks = vi.fn();
    const stop = intervalFreshness(1000).start(ticks);
    stop();
    expect(() => stop()).not.toThrow();
    vi.advanceTimersByTime(5000);
    expect(ticks).not.toHaveBeenCalled();
  });
});

describe('startLiveness — the detail page’s whole liveness policy', () => {
  function crankDriver(): { driver: FreshnessDriver; tick: () => void; stops: () => number } {
    let onTick: (() => void) | undefined;
    let stops = 0;
    return {
      driver: {
        start(handler) {
          onTick = handler;
          return () => {
            stops += 1;
          };
        },
      },
      tick: () => onTick?.(),
      stops: () => stops,
    };
  }

  async function settle(): Promise<void> {
    await new Promise((resolve) => {
      setTimeout(resolve, 0);
    });
  }

  it('rests when the story is settled — and clears any stale failure banner', () => {
    const { driver } = crankDriver();
    const outcomes: boolean[] = [];
    const stop = startLiveness(true, driver, {
      refresh: () => Promise.resolve(),
      onRefreshFailed: (didFail) => {
        outcomes.push(didFail);
      },
    });
    expect(stop).toBeUndefined();
    expect(outcomes).toEqual([false]);
  });

  it('ticks the refresh while unsettled and reports success', async () => {
    const { driver, tick } = crankDriver();
    const refresh = vi.fn(() => Promise.resolve());
    const outcomes: boolean[] = [];
    const stop = startLiveness(false, driver, {
      refresh,
      onRefreshFailed: (didFail) => {
        outcomes.push(didFail);
      },
    });
    tick();
    await settle();
    expect(refresh).toHaveBeenCalledTimes(1);
    expect(outcomes).toEqual([false]);
    stop?.();
  });

  it('surfaces a failed refresh, then recovers on the next success', async () => {
    const { driver, tick } = crankDriver();
    let shouldFail = true;
    const outcomes: boolean[] = [];
    const stop = startLiveness(false, driver, {
      refresh: () => (shouldFail ? Promise.reject(new Error('offline')) : Promise.resolve()),
      onRefreshFailed: (didFail) => {
        outcomes.push(didFail);
      },
    });
    tick();
    await settle();
    shouldFail = false;
    tick();
    await settle();
    expect(outcomes).toEqual([true, false]);
    stop?.();
  });

  it('returns the driver’s stop function for teardown', () => {
    const { driver, stops } = crankDriver();
    const stop = startLiveness(false, driver, {
      refresh: () => Promise.resolve(),
      onRefreshFailed: () => {},
    });
    stop?.();
    expect(stops()).toBe(1);
  });
});
