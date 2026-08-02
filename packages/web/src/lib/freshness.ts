/**
 * The detail page's freshness driver (design D8): the one seam that decides *when* the page
 * re-fetches its own data. Today it is a plain interval; a future push change (SSE) replaces this
 * implementation — the views consume page data only and never learn how freshness arrives. No new
 * wire endpoint: the tick callback re-runs the page's existing load.
 */

export interface FreshnessDriver {
  /** Start ticking; returns a stop function (idempotent). */
  readonly start: (onTick: () => void) => () => void;
}

export function intervalFreshness(intervalMs: number): FreshnessDriver {
  return {
    start(onTick: () => void): () => void {
      const handle = setInterval(onTick, intervalMs);
      return () => {
        clearInterval(handle);
      };
    },
  };
}

/** The production cadence: frequent enough to feel alive, gentle enough for a single-user page. */
export const DETAIL_REFRESH_MS = 5000;

/**
 * The detail page's driver instance — the swap point (design D8): an SSE successor replaces this
 * export (and nothing else); the page and views never learn how freshness arrives.
 */
export const detailFreshness: FreshnessDriver = intervalFreshness(DETAIL_REFRESH_MS);
