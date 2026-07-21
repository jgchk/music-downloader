import { describe, expect, it } from 'vitest';
import { phaseLabel } from './phase-label.js';

describe('phaseLabel', () => {
  it.each([
    ['pending', 'Working'],
    ['fulfilled', 'Done'],
    ['failed', 'Failed'],
  ] as const)('labels %s as %s', (phase, label) => {
    expect(phaseLabel(phase)).toBe(label);
  });
});
