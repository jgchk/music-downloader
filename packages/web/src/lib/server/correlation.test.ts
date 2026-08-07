import { describe, expect, it } from 'vitest';
import { mintCorrelationId } from './correlation.js';

/**
 * The BFF owns the mint, so this is the one place the FORMAT contract is proved rather than
 * assumed. Every downstream lift (`toCorrelationId`) is a trusted cast, and both modules' tolerant
 * readers reject anything that is not 32 lowercase hex — so a mint that drifted out of format
 * would not fail loudly, it would silently stop crossing the seam.
 */
describe('mintCorrelationId', () => {
  it('mints a W3C-trace-id-compatible id: 32 lowercase hex characters', () => {
    for (let attempt = 0; attempt < 100; attempt += 1) {
      expect(mintCorrelationId()).toMatch(/^[0-9a-f]{32}$/);
    }
  });

  it('mints a distinct id per call — one story per unit of work, never a shared one', () => {
    const minted = new Set(Array.from({ length: 1000 }, () => mintCorrelationId()));

    expect(minted.size).toBe(1000);
  });
});
