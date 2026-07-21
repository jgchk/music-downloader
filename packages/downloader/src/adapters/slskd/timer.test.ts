import { describe, expect, it } from 'vitest';
import { realTimer } from './timer.js';

describe('realTimer', () => {
  it('reports a numeric clock and sleeps without hanging', async () => {
    const before = realTimer.now();
    expect(typeof before).toBe('number');

    await realTimer.sleep(1);
    expect(realTimer.now()).toBeGreaterThanOrEqual(before);
  });
});
