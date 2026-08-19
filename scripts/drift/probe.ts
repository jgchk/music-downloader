/**
 * Shared judgement for the tier-2 drift checks (change: drift-signal-fidelity).
 *
 * A live drift check answers one question — *has a provider changed a shape we consume?* — by
 * going to the live world, which entangles it with a second question it must not confuse with the
 * first: *could we reach the live world at all?* Both alerts this job has ever raised were the
 * second mistaken for the first (#110, a broken invocation; #184, two MusicBrainz 503s on a
 * shared GitHub-runner egress IP), and a detector whose whole alert history is noise is a
 * detector nobody reads when the real dropped field finally arrives.
 *
 * So a check reports one of three outcomes and this module owns the split:
 *
 * - `conforms`     — the provider answered and the response satisfies the contract schema.
 * - `drift`        — the provider answered and the consumed surface changed. LOUD: fails the run,
 *                    opens or refreshes the tracking issue.
 * - `unavailable`  — we could not reach the provider, so the contract was neither confirmed nor
 *                    refuted. QUIET: the run stays green and reports a warning.
 *
 * The dangerous edge is what counts as unreachable. A removed operation (404/410) and a surface
 * that grew an auth requirement (401/403) are *changes*, not outages — classifying them as
 * unavailable is precisely how a quiet outcome would mask the failure it exists to report. Only
 * the statuses a provider uses to say "not now" are transient.
 *
 * `probe` takes its clock so the retry schedule is unit-testable without waiting for it.
 */

/** The statuses a provider uses to mean "not now" — everything else is a statement about shape. */
export const TRANSIENT_STATUSES = [408, 425, 429, 500, 502, 503, 504] as const;

/** The wait before each retry when the provider names no interval of its own. */
export const RETRY_BACKOFF_MS = [2000, 5000, 10_000] as const;

/**
 * Total attempts per request, initial included — derived from the backoff schedule rather than
 * stated beside it, so the two can never drift into disagreeing about how many retries there are.
 */
export const MAX_ATTEMPTS = RETRY_BACKOFF_MS.length + 1;

/**
 * A provider is entitled to ask for an hour; a weekly job is not entitled to sit for one. Above
 * this, giving up IS the honest report: we were told to come back later than this run will wait.
 */
export const RETRY_AFTER_CEILING_MS = 30_000;

export type DriftOutcome = 'conforms' | 'drift' | 'unavailable';

/** The exit code each outcome leaves for `.github/workflows/contract-drift.yml` to route on. */
export const DRIFT_EXIT_CODES: Readonly<Record<DriftOutcome, number>> = {
  conforms: 0,
  drift: 1,
  unavailable: 2,
};

export type ProbeResult =
  /** The provider answered. A non-2xx here is terminal — the caller classifies what it means. */
  | { readonly kind: 'response'; readonly response: Response }
  /** We never got an answer worth reading. Never drift. */
  | { readonly kind: 'unavailable'; readonly reason: string };

export interface ProbeOptions {
  /** Injected so tests assert the intended schedule instead of living through it. */
  readonly sleep?: (ms: number) => Promise<void>;
  /** Injected so an HTTP-date `Retry-After` is deterministic. */
  readonly now?: () => number;
}

export function isTransientStatus(status: number): boolean {
  return (TRANSIENT_STATUSES as readonly number[]).includes(status);
}

/**
 * The delay a `Retry-After` asks for, in milliseconds, or `undefined` when the header is absent,
 * unparseable, or asks for a wait in the past — in every one of which cases the caller falls back
 * to its own backoff rather than inventing a number from a header it did not understand. A date
 * already past means "go now", which is a zero wait, not a negative one.
 */
export function retryAfterMs(header: string | null, now: number): number | undefined {
  // `Number('')` is 0, so an empty header would otherwise read as "retry immediately" and hammer a
  // provider that told us nothing.
  if (header === null || header.trim() === '') return undefined;
  const seconds = Number(header);
  if (Number.isFinite(seconds)) return seconds < 0 ? undefined : seconds * 1000;
  const date = Date.parse(header);
  if (Number.isNaN(date)) return undefined;
  return Math.max(0, date - now);
}

function defaultSleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function describeRejection(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

/**
 * Issue one live request, retrying only what is worth retrying, and never throwing: a transport
 * fault escaping as an exception would abort the whole check and be reported as the broken-checker
 * failure that #110 was, rather than as the outage it is.
 */
export async function probe(
  request: () => Promise<Response>,
  options: ProbeOptions = {},
): Promise<ProbeResult> {
  const sleep = options.sleep ?? defaultSleep;
  const now = options.now ?? Date.now;
  let lastFailure = 'no attempt was made';

  for (let attempt = 0; attempt < MAX_ATTEMPTS; attempt += 1) {
    // The vendor call is the only thing allowed to throw, and it is converted here, at the call.
    let outcome: { response: Response } | { rejection: unknown };
    try {
      outcome = { response: await request() };
    } catch (error) {
      outcome = { rejection: error };
    }

    let asked: number | undefined;
    if ('response' in outcome) {
      const { response } = outcome;
      if (response.ok || !isTransientStatus(response.status)) return { kind: 'response', response };
      lastFailure = `HTTP ${response.status}`;

      asked = retryAfterMs(response.headers.get('retry-after'), now());
      if (asked !== undefined && asked > RETRY_AFTER_CEILING_MS) {
        return {
          kind: 'unavailable',
          reason: `${lastFailure}, Retry-After ${asked}ms exceeds the ${RETRY_AFTER_CEILING_MS}ms this run will wait`,
        };
      }
    } else {
      lastFailure = describeRejection(outcome.rejection);
    }

    // No backoff entry for this attempt means it was the last one — the schedule's length IS the
    // retry budget, so there is no separate bound to keep in step with it.
    const backoff = RETRY_BACKOFF_MS[attempt];
    if (backoff !== undefined) await sleep(asked ?? backoff);
  }

  return { kind: 'unavailable', reason: `${lastFailure} after ${MAX_ATTEMPTS} attempts` };
}

/**
 * A run's outcome is its worst check. Drift outranks unavailability because a proven violation
 * beats an unproven one: a run that reached four endpoints and found a broken shape on the fifth
 * has found drift, whatever it failed to reach afterwards.
 */
export function worstOutcome(outcomes: readonly DriftOutcome[]): DriftOutcome {
  if (outcomes.includes('drift')) return 'drift';
  if (outcomes.includes('unavailable')) return 'unavailable';
  return 'conforms';
}
