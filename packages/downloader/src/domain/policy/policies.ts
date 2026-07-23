import { err, ok } from 'neverthrow';
import type { Result } from 'neverthrow';
import { branded } from '../shared/brand.js';
import type { Brand } from '../shared/brand.js';
import type { QualityPolicy } from './quality-policy.js';

/**
 * The three scalar per-acquisition policies (D5/D6/D10). Together with {@link QualityPolicy}
 * they form the whole configuration surface; each has a smart constructor so config loaded
 * from the environment fails fast (12-factor).
 */

// --- MatchPolicy: the validation/search confidence threshold (D5) -----------------------------

/**
 * Branded so a validated policy cannot be forged from a raw `{ threshold }` literal: the only way
 * to obtain a `MatchPolicy` is through {@link createMatchPolicy}, which proves the invariant. The
 * brand is compile-time only and erases at runtime, so the value still round-trips as plain JSON.
 */
export type MatchPolicy = Brand<{ readonly threshold: number }, 'MatchPolicy'>; // confidence in [0, 1]

export type MatchPolicyError = { readonly kind: 'ThresholdOutOfRange' };

export function createMatchPolicy(threshold: number): Result<MatchPolicy, MatchPolicyError> {
  if (!(threshold >= 0 && threshold <= 1)) return err({ kind: 'ThresholdOutOfRange' });
  return ok(branded<MatchPolicy>({ threshold }));
}

export const DEFAULT_MATCH_POLICY: MatchPolicy = createMatchPolicy(0.7)._unsafeUnwrap();

// --- RetryPolicy: the retry-loop termination bounds (D6) ---------------------------------------

export type RetryPolicy = Brand<
  {
    readonly maxSearchRounds: number;
    readonly maxTotalAttempts: number;
    readonly timeBudgetMs?: number; // optional; off by default
  },
  'RetryPolicy'
>;

export type RetryPolicyError =
  | { readonly kind: 'NonPositiveSearchRounds' }
  | { readonly kind: 'NonPositiveTotalAttempts' }
  | { readonly kind: 'NonPositiveTimeBudget' };

export interface RetryPolicyInput {
  readonly maxSearchRounds: number;
  readonly maxTotalAttempts: number;
  readonly timeBudgetMs?: number;
}

export function createRetryPolicy(input: RetryPolicyInput): Result<RetryPolicy, RetryPolicyError> {
  if (input.maxSearchRounds < 1) return err({ kind: 'NonPositiveSearchRounds' });
  if (input.maxTotalAttempts < 1) return err({ kind: 'NonPositiveTotalAttempts' });
  if (input.timeBudgetMs !== undefined && input.timeBudgetMs <= 0) {
    return err({ kind: 'NonPositiveTimeBudget' });
  }
  return ok(
    branded<RetryPolicy>({
      maxSearchRounds: input.maxSearchRounds,
      maxTotalAttempts: input.maxTotalAttempts,
      timeBudgetMs: input.timeBudgetMs,
    }),
  );
}

export const DEFAULT_RETRY_POLICY: RetryPolicy = createRetryPolicy({
  maxSearchRounds: 3,
  maxTotalAttempts: 15,
})._unsafeUnwrap();

// --- DownloadPolicy: transfer timeout thresholds (D10) -----------------------------------------

export type DownloadPolicy = Brand<
  {
    readonly stallTimeoutMs: number;
    readonly maxQueueWaitMs: number;
  },
  'DownloadPolicy'
>;

export type DownloadPolicyError =
  { readonly kind: 'NonPositiveStallTimeout' } | { readonly kind: 'NonPositiveQueueWait' };

export interface DownloadPolicyInput {
  readonly stallTimeoutMs: number;
  readonly maxQueueWaitMs: number;
}

export function createDownloadPolicy(
  input: DownloadPolicyInput,
): Result<DownloadPolicy, DownloadPolicyError> {
  if (input.stallTimeoutMs <= 0) return err({ kind: 'NonPositiveStallTimeout' });
  if (input.maxQueueWaitMs <= 0) return err({ kind: 'NonPositiveQueueWait' });
  return ok(
    branded<DownloadPolicy>({
      stallTimeoutMs: input.stallTimeoutMs,
      maxQueueWaitMs: input.maxQueueWaitMs,
    }),
  );
}

export const DEFAULT_DOWNLOAD_POLICY: DownloadPolicy = createDownloadPolicy({
  stallTimeoutMs: 60_000,
  maxQueueWaitMs: 600_000,
})._unsafeUnwrap();

// --- The bundle carried on an acquisition ------------------------------------------------------

export interface AcquisitionPolicies {
  readonly quality: QualityPolicy;
  readonly match: MatchPolicy;
  readonly retry: RetryPolicy;
  readonly download: DownloadPolicy;
}
