import { describe, expect, it } from 'vitest';
import { parseDistance } from './distance.js';

describe('parseDistance', () => {
  it('accepts the closed unit interval, preserving the value', () => {
    expect(parseDistance(0)._unsafeUnwrap()).toBe(0);
    expect(parseDistance(0.42)._unsafeUnwrap()).toBe(0.42);
    expect(parseDistance(1)._unsafeUnwrap()).toBe(1);
  });

  it('rejects a value below 0 or above 1', () => {
    expect(parseDistance(-0.01)._unsafeUnwrapErr()).toEqual({
      kind: 'InvalidDistance',
      value: -0.01,
    });
    expect(parseDistance(1.5)._unsafeUnwrapErr()).toEqual({ kind: 'InvalidDistance', value: 1.5 });
  });

  it('rejects a non-finite value so it can never silently misroute auto-apply', () => {
    expect(parseDistance(NaN)._unsafeUnwrapErr()).toEqual({
      kind: 'InvalidDistance',
      value: NaN,
    });
    expect(parseDistance(Infinity)._unsafeUnwrapErr()).toEqual({
      kind: 'InvalidDistance',
      value: Infinity,
    });
  });
});
