import { describe, expect, it } from 'vitest';
import { toAcquisitionId } from './acquisition-id.js';

describe('toAcquisitionId', () => {
  it('lifts a seam-validated id into the brand, preserving the string', () => {
    expect(toAcquisitionId('acq-1')).toBe('acq-1');
  });
});
