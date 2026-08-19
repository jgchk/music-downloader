import { describe, expect, it } from 'vitest';
import { toOriginatingDownloadId } from './originating-download-id.js';

describe('toOriginatingDownloadId', () => {
  it('lifts a seam-validated id into the brand, preserving the string', () => {
    expect(toOriginatingDownloadId('acq-1')).toBe('acq-1');
  });
});
