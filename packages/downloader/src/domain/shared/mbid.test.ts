import { describe, expect, it } from 'vitest';
import { parseMbid } from './mbid.js';

describe('parseMbid', () => {
  it('accepts a canonical UUID and preserves its text', () => {
    const raw = 'b1392450-e666-3926-a536-22c65f834433';
    expect(parseMbid(raw)._unsafeUnwrap()).toBe(raw);
  });

  it('lower-cases an upper-case UUID so ids compare canonically', () => {
    expect(parseMbid('B1392450-E666-3926-A536-22C65F834433')._unsafeUnwrap()).toBe(
      'b1392450-e666-3926-a536-22c65f834433',
    );
  });

  it('rejects an empty string', () => {
    expect(parseMbid('')._unsafeUnwrapErr()).toEqual({ kind: 'InvalidMbid', value: '' });
  });

  it('rejects a non-UUID string', () => {
    expect(parseMbid('not-a-uuid')._unsafeUnwrapErr()).toEqual({
      kind: 'InvalidMbid',
      value: 'not-a-uuid',
    });
  });
});
