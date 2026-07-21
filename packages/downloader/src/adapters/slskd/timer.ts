/**
 * A tiny timing seam for the slskd adapters: slskd searches and transfers are polled, and the
 * download adapter enforces stall / queue-wait thresholds against wall-clock time. Behind an
 * interface so tests drive polling and timeouts deterministically — no real sleeping in CI (D14).
 */
export interface Timer {
  /** Epoch milliseconds; used only for elapsed-time comparisons, so monotonicity is enough. */
  now(): number;
  sleep(ms: number): Promise<void>;
}

export const realTimer: Timer = {
  now: () => Date.now(),
  sleep: (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
};
