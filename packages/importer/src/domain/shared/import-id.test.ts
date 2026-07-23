import { describe, expect, it } from 'vitest';
import { toImportId } from './import-id.js';

describe('toImportId', () => {
  it('lifts a known import-stream id into the brand, preserving the string', () => {
    expect(toImportId('imp-abc')).toBe('imp-abc');
  });
});
