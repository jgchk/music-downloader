import { describe, expect, it } from 'vitest';
import { toPositiveInt } from './positive-int.js';

describe('toPositiveInt', () => {
  it('lifts a schema-validated ordinal into the brand, preserving the number', () => {
    expect(toPositiveInt(1)).toBe(1);
    expect(toPositiveInt(12)).toBe(12);
  });
});
