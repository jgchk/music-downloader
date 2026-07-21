import { describe, expect, it } from 'vitest';
import {
  createDownloadPolicy,
  createMatchPolicy,
  createRetryPolicy,
  DEFAULT_DOWNLOAD_POLICY,
  DEFAULT_MATCH_POLICY,
  DEFAULT_RETRY_POLICY,
} from './policies.js';

describe('createMatchPolicy', () => {
  it('accepts a threshold within [0, 1]', () => {
    expect(createMatchPolicy(0.85)._unsafeUnwrap()).toEqual({ threshold: 0.85 });
  });

  it('rejects thresholds outside the range or NaN', () => {
    expect(createMatchPolicy(-0.1)._unsafeUnwrapErr()).toEqual({ kind: 'ThresholdOutOfRange' });
    expect(createMatchPolicy(1.1)._unsafeUnwrapErr()).toEqual({ kind: 'ThresholdOutOfRange' });
    expect(createMatchPolicy(Number.NaN)._unsafeUnwrapErr()).toEqual({
      kind: 'ThresholdOutOfRange',
    });
  });

  it('has a sensible default', () => {
    expect(DEFAULT_MATCH_POLICY.threshold).toBeGreaterThan(0);
  });
});

describe('createRetryPolicy', () => {
  it('accepts positive bounds, with the time budget optional', () => {
    expect(createRetryPolicy({ maxSearchRounds: 2, maxTotalAttempts: 10 })._unsafeUnwrap()).toEqual(
      { maxSearchRounds: 2, maxTotalAttempts: 10, timeBudgetMs: undefined },
    );
    expect(
      createRetryPolicy({
        maxSearchRounds: 1,
        maxTotalAttempts: 5,
        timeBudgetMs: 1000,
      })._unsafeUnwrap().timeBudgetMs,
    ).toBe(1000);
  });

  it('rejects non-positive bounds', () => {
    expect(
      createRetryPolicy({ maxSearchRounds: 0, maxTotalAttempts: 10 })._unsafeUnwrapErr(),
    ).toEqual({ kind: 'NonPositiveSearchRounds' });
    expect(
      createRetryPolicy({ maxSearchRounds: 1, maxTotalAttempts: 0 })._unsafeUnwrapErr(),
    ).toEqual({ kind: 'NonPositiveTotalAttempts' });
    expect(
      createRetryPolicy({
        maxSearchRounds: 1,
        maxTotalAttempts: 5,
        timeBudgetMs: 0,
      })._unsafeUnwrapErr(),
    ).toEqual({ kind: 'NonPositiveTimeBudget' });
  });

  it('has sensible defaults', () => {
    expect(DEFAULT_RETRY_POLICY).toEqual({ maxSearchRounds: 3, maxTotalAttempts: 15 });
  });
});

describe('createDownloadPolicy', () => {
  it('accepts positive timeouts', () => {
    expect(
      createDownloadPolicy({ stallTimeoutMs: 1000, maxQueueWaitMs: 5000 })._unsafeUnwrap(),
    ).toEqual({ stallTimeoutMs: 1000, maxQueueWaitMs: 5000 });
  });

  it('rejects non-positive timeouts', () => {
    expect(
      createDownloadPolicy({ stallTimeoutMs: 0, maxQueueWaitMs: 5000 })._unsafeUnwrapErr(),
    ).toEqual({ kind: 'NonPositiveStallTimeout' });
    expect(
      createDownloadPolicy({ stallTimeoutMs: 1000, maxQueueWaitMs: -1 })._unsafeUnwrapErr(),
    ).toEqual({ kind: 'NonPositiveQueueWait' });
  });

  it('has sensible defaults', () => {
    expect(DEFAULT_DOWNLOAD_POLICY.stallTimeoutMs).toBeGreaterThan(0);
    expect(DEFAULT_DOWNLOAD_POLICY.maxQueueWaitMs).toBeGreaterThan(0);
  });
});
