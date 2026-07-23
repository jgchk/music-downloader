/**
 * The parked-effect backoff policy (reactor-durability D2): exponential with jitter, capped per
 * interval, bounded by a wall-clock budget measured from when the stream was first parked — not by
 * attempts alone, so a genuine outage rides it out while a permanent condition lands. Pure: the
 * caller supplies the clock readings and the jitter roll.
 */
export interface RetryPolicy {
  readonly initialDelayMs: number;
  readonly maxDelayMs: number;
  /** Wall-clock budget from first park to exhaustion. */
  readonly budgetMs: number;
}

export const DEFAULT_RETRY_POLICY: RetryPolicy = {
  initialDelayMs: 5000,
  maxDelayMs: 900_000, // 15 min
  budgetMs: 21_600_000, // 6 h — deliberately generous: only a permanent condition exhausts it
};

export type RetrySchedule =
  { readonly kind: 'retry'; readonly nextRetryAt: Date } | { readonly kind: 'exhausted' };

/**
 * Schedule the next retry for the `attempt`-th failure (1-based) of an effect parked at
 * `parkedAt`, or signal budget exhaustion. `random` ∈ [0, 1] jitters the delay across
 * [half, full] of the exponential step so synchronized failures do not retry in lockstep.
 */
export function nextRetry(
  policy: RetryPolicy,
  attempt: number,
  parkedAt: Date,
  now: Date,
  random: number,
): RetrySchedule {
  if (now.getTime() - parkedAt.getTime() >= policy.budgetMs) return { kind: 'exhausted' };
  const step = Math.min(policy.initialDelayMs * 2 ** (attempt - 1), policy.maxDelayMs);
  const delay = step / 2 + (step / 2) * random;
  return { kind: 'retry', nextRetryAt: new Date(now.getTime() + delay) };
}
