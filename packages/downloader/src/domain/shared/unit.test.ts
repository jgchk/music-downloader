import { describe, expect, it } from 'vitest';
import { clampUnit, parseUnit } from './unit.js';

describe('parseUnit', () => {
  it('accepts the closed unit interval, preserving the value', () => {
    expect(parseUnit(0)._unsafeUnwrap()).toBe(0);
    expect(parseUnit(0.42)._unsafeUnwrap()).toBe(0.42);
    expect(parseUnit(1)._unsafeUnwrap()).toBe(1);
  });

  it('rejects a value below 0 or above 1', () => {
    expect(parseUnit(-0.01)._unsafeUnwrapErr()).toEqual({ kind: 'OutOfUnitRange', value: -0.01 });
    expect(parseUnit(1.5)._unsafeUnwrapErr()).toEqual({ kind: 'OutOfUnitRange', value: 1.5 });
  });

  it('rejects a non-finite value so a range can never be forged from NaN', () => {
    expect(parseUnit(Number.NaN)._unsafeUnwrapErr()).toEqual({
      kind: 'OutOfUnitRange',
      value: Number.NaN,
    });
    expect(parseUnit(Number.POSITIVE_INFINITY)._unsafeUnwrapErr()).toEqual({
      kind: 'OutOfUnitRange',
      value: Number.POSITIVE_INFINITY,
    });
  });
});

describe('clampUnit', () => {
  it('passes an in-range value through unchanged', () => {
    expect(clampUnit(0)).toBe(0);
    expect(clampUnit(0.42)).toBe(0.42);
    expect(clampUnit(1)).toBe(1);
  });

  it('clamps an out-of-range computed value to the nearest bound', () => {
    expect(clampUnit(-0.3)).toBe(0);
    expect(clampUnit(1.2)).toBe(1);
  });
});
