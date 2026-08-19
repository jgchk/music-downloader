import { describe, expect, it, vi } from 'vitest';
import { MIN_QUERY_LENGTH, debouncedTyping, startTyping } from './typing.js';
import type { TypingDriver } from './typing.js';

/** A driver that hands back its callback instead of waiting, so settling is a test's decision. */
function manualDriver(): TypingDriver & { settle_: () => void; cancels: () => number } {
  let pending: (() => void) | undefined;
  let cancels = 0;
  return {
    settle(onSettled) {
      pending = onSettled;
      return () => {
        cancels += 1;
      };
    },
    settle_: () => pending?.(),
    cancels: () => cancels,
  };
}

describe('startTyping', () => {
  it('waits for the typing to settle before searching', () => {
    const driver = manualDriver();
    const search = vi.fn();

    startTyping('graceland', false, driver, { clear: vi.fn(), search });

    expect(search).not.toHaveBeenCalled();
    driver.settle_();
    expect(search).toHaveBeenCalledWith('graceland');
  });

  it('searches at once when the person asks for it, without waiting', () => {
    const driver = manualDriver();
    const search = vi.fn();

    const stop = startTyping('graceland', true, driver, { clear: vi.fn(), search });

    expect(search).toHaveBeenCalledWith('graceland');
    expect(stop).toBeUndefined();
  });

  it('searches for what was typed, not for the spaces around it', () => {
    const driver = manualDriver();
    const search = vi.fn();

    startTyping('  graceland  ', true, driver, { clear: vi.fn(), search });

    expect(search).toHaveBeenCalledWith('graceland');
  });

  it('clears rather than searching for too little to search on', () => {
    const driver = manualDriver();
    const clear = vi.fn();
    const search = vi.fn();

    const stop = startTyping('g'.repeat(MIN_QUERY_LENGTH - 1), false, driver, { clear, search });

    expect(clear).toHaveBeenCalled();
    expect(search).not.toHaveBeenCalled();
    expect(stop).toBeUndefined();
  });

  it('hands back the way to abandon a search that has not happened yet', () => {
    const driver = manualDriver();

    const stop = startTyping('graceland', false, driver, { clear: vi.fn(), search: vi.fn() });
    stop?.();

    expect(driver.cancels()).toBe(1);
  });
});

describe('debouncedTyping', () => {
  it('settles once the typing pauses', () => {
    vi.useFakeTimers();
    const settled = vi.fn();

    debouncedTyping(600).settle(settled);
    vi.advanceTimersByTime(599);
    expect(settled).not.toHaveBeenCalled();
    vi.advanceTimersByTime(1);
    expect(settled).toHaveBeenCalledTimes(1);

    vi.useRealTimers();
  });

  it('does not settle once abandoned', () => {
    vi.useFakeTimers();
    const settled = vi.fn();

    const cancel = debouncedTyping(600).settle(settled);
    cancel();
    vi.advanceTimersByTime(1000);

    expect(settled).not.toHaveBeenCalled();
    vi.useRealTimers();
  });
});
