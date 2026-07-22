import { describe, expect, it } from 'vitest';
import { DEFAULT_RETRY_POLICY, nextRetry } from './retry-policy.js';

const POLICY = { initialDelayMs: 5_000, maxDelayMs: 900_000, budgetMs: 21_600_000 };
const T0 = new Date('2026-07-22T12:00:00.000Z');

const at = (offsetMs: number): Date => new Date(T0.getTime() + offsetMs);

describe('nextRetry', () => {
  it('doubles the delay per attempt from the initial delay', () => {
    const first = nextRetry(POLICY, 1, T0, T0, 1);
    const second = nextRetry(POLICY, 2, T0, T0, 1);
    const third = nextRetry(POLICY, 3, T0, T0, 1);

    expect(first).toEqual({ kind: 'retry', nextRetryAt: at(5_000) });
    expect(second).toEqual({ kind: 'retry', nextRetryAt: at(10_000) });
    expect(third).toEqual({ kind: 'retry', nextRetryAt: at(20_000) });
  });

  it('caps the delay at the configured maximum interval', () => {
    const capped = nextRetry(POLICY, 30, T0, T0, 1);

    expect(capped).toEqual({ kind: 'retry', nextRetryAt: at(900_000) });
  });

  it('jitters within [half, full] of the exponential delay', () => {
    const floor = nextRetry(POLICY, 1, T0, T0, 0);
    const ceiling = nextRetry(POLICY, 1, T0, T0, 1);

    expect(floor).toEqual({ kind: 'retry', nextRetryAt: at(2_500) });
    expect(ceiling).toEqual({ kind: 'retry', nextRetryAt: at(5_000) });
  });

  it('signals exhaustion once the wall-clock budget since parking has elapsed', () => {
    const inside = nextRetry(POLICY, 12, T0, at(POLICY.budgetMs - 1), 0.5);
    const spent = nextRetry(POLICY, 12, T0, at(POLICY.budgetMs), 0.5);

    expect(inside.kind).toBe('retry');
    expect(spent).toEqual({ kind: 'exhausted' });
  });

  it('exhausts on wall-clock time regardless of how few attempts ran', () => {
    // A long outage with sparse retries must still land after the budget, not retry forever.
    expect(nextRetry(POLICY, 1, T0, at(POLICY.budgetMs + 60_000), 0.5)).toEqual({
      kind: 'exhausted',
    });
  });

  it('ships defaults: 5s initial, 15min cap, 6h budget', () => {
    expect(DEFAULT_RETRY_POLICY).toEqual(POLICY);
  });
});
