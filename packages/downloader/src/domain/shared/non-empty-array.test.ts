import { describe, expect, it } from 'vitest';
import { assertNonEmpty, isNonEmpty } from './non-empty-array.js';

describe('isNonEmpty', () => {
  it('narrows a populated array and rejects an empty one', () => {
    expect(isNonEmpty([1])).toBe(true);
    expect(isNonEmpty([])).toBe(false);
  });
});

describe('assertNonEmpty', () => {
  it('returns a guard-proven array unchanged as a non-empty tuple', () => {
    const values = ['a', 'b'];
    expect(assertNonEmpty(values)).toBe(values);
  });
});
