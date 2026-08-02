import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { intervalFreshness } from './freshness.js';

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
