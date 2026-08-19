import { describe, expect, it } from 'vitest';
import {
  DRIFT_EXIT_CODES,
  MAX_ATTEMPTS,
  RETRY_AFTER_CEILING_MS,
  RETRY_BACKOFF_MS,
  TRANSIENT_STATUSES,
  isTransientStatus,
  probe,
  retryAfterMs,
  worstOutcome,
} from './probe.ts';

/**
 * The tier-2 drift job's judgement, one level down: is a failed live request evidence about the
 * provider's *contract*, or only about our ability to reach it? Every alert this job has ever
 * produced (issues #110 and #184) was the second mistaken for the first, so the split these tests
 * pin is the whole point of the change — a classifier that leans one way files noise nobody reads,
 * and one that leans the other way masks a genuinely removed endpoint.
 *
 * Nothing here sleeps: `probe` takes its clock, so the retry schedule is asserted as a recorded
 * list of intended delays rather than by waiting for them.
 */

/** A `probe` harness whose fetches are scripted and whose sleeps are recorded, never taken. */
function harness(attempts: readonly [Response | Error, ...(Response | Error)[]], now = 0) {
  const slept: number[] = [];
  const requested: number[] = [];
  let index = 0;
  const request = (): Promise<Response> => {
    requested.push(index);
    // Past the end, the last scripted answer repeats — that is how "the provider is simply down"
    // is expressed without writing MAX_ATTEMPTS copies of the same 503.
    const next = attempts.at(Math.min(index, attempts.length - 1)) ?? attempts[0];
    index += 1;
    return next instanceof Error ? Promise.reject(next) : Promise.resolve(next);
  };
  const options = {
    sleep: (ms: number): Promise<void> => {
      slept.push(ms);
      return Promise.resolve();
    },
    now: () => now,
  };
  return { request, options, slept, attemptCount: () => requested.length };
}

function unavailable(status: number, headers?: Record<string, string>): Response {
  return new Response(undefined, { status, headers });
}

describe('the transient/terminal split', () => {
  it.each([...TRANSIENT_STATUSES])(
    'treats %i as transient — a fault to retry, not drift',
    (status) => {
      expect(isTransientStatus(status)).toBe(true);
    },
  );

  // The important members: a removed operation (404/410) and a surface that grew an auth
  // requirement (401/403) are real changes to what we consume. Filing them as "the provider was
  // busy" is the exact mask a quiet unavailable outcome would otherwise create.
  it.each([400, 401, 403, 404, 410, 422, 501, 505])(
    'treats %i as terminal — the consumed surface changed',
    (status) => {
      expect(isTransientStatus(status)).toBe(false);
    },
  );

  it('lists 501 nowhere in the transient set, so a not-implemented operation stays loud', () => {
    expect(TRANSIENT_STATUSES).not.toContain(501);
  });
});

describe('Retry-After', () => {
  it('reads the delta-seconds spelling', () => {
    expect(retryAfterMs('120', 0)).toBe(120_000);
  });

  it('reads the HTTP-date spelling, relative to the injected clock', () => {
    const now = Date.parse('Mon, 17 Aug 2026 07:00:00 GMT');
    expect(retryAfterMs('Mon, 17 Aug 2026 07:00:30 GMT', now)).toBe(30_000);
  });

  it('reads a date already in the past as no wait at all, never as a negative delay', () => {
    const now = Date.parse('Mon, 17 Aug 2026 07:00:00 GMT');
    expect(retryAfterMs('Mon, 17 Aug 2026 06:59:00 GMT', now)).toBe(0);
  });

  it('declines an unparseable value so the caller falls back to its own backoff', () => {
    expect(retryAfterMs('soon', 0)).toBeUndefined();
  });

  it('declines an absent header', () => {
    expect(retryAfterMs(null, 0)).toBeUndefined();
  });

  it('declines a negative delta-seconds rather than reading it as a wait', () => {
    expect(retryAfterMs('-5', 0)).toBeUndefined();
  });

  it('declines an empty header rather than reading it as "retry immediately"', () => {
    expect(retryAfterMs('', 0)).toBeUndefined();
  });
});

describe('probing a live request', () => {
  it('returns the response untouched when the first attempt succeeds', async () => {
    const { request, options, slept } = harness([new Response('{}', { status: 200 })]);

    const result = await probe(request, options);

    expect(result).toMatchObject({ kind: 'response' });
    expect(slept).toEqual([]);
  });

  it('returns a terminal non-2xx to the caller to classify, without retrying it', async () => {
    const { request, options, slept, attemptCount } = harness([unavailable(404)]);

    const result = await probe(request, options);

    expect(result.kind).toBe('response');
    expect(attemptCount()).toBe(1);
    expect(slept).toEqual([]);
  });

  it('retries a transient status and returns the response that clears it', async () => {
    const { request, options, slept } = harness([
      unavailable(503),
      new Response('{}', { status: 200 }),
    ]);

    const result = await probe(request, options);

    expect(result.kind).toBe('response');
    expect(result.kind === 'response' && result.response.status).toBe(200);
    expect(slept).toEqual([RETRY_BACKOFF_MS[0]]);
  });

  it('waits the interval the provider named instead of its own backoff', async () => {
    const { request, options, slept } = harness([
      unavailable(429, { 'Retry-After': '7' }),
      new Response('{}', { status: 200 }),
    ]);

    await probe(request, options);

    expect(slept).toEqual([7000]);
  });

  it('backs off increasingly across attempts and gives up as unavailable', async () => {
    const { request, options, slept, attemptCount } = harness([unavailable(503)]);

    const result = await probe(request, options);

    expect(result).toEqual({
      kind: 'unavailable',
      reason: `HTTP 503 after ${MAX_ATTEMPTS} attempts`,
    });
    expect(attemptCount()).toBe(MAX_ATTEMPTS);
    expect(slept).toEqual([...RETRY_BACKOFF_MS]);
  });

  it('stops immediately when the provider asks for longer than the run will wait', async () => {
    const { request, options, slept, attemptCount } = harness([
      unavailable(503, { 'Retry-After': '3600' }),
    ]);

    const result = await probe(request, options);

    expect(result).toEqual({
      kind: 'unavailable',
      reason: 'HTTP 503, Retry-After 3600000ms exceeds the 30000ms this run will wait',
    });
    expect(attemptCount()).toBe(1);
    expect(slept).toEqual([]);
  });

  it('treats a transport fault as transient and never lets it escape as an exception', async () => {
    const { request, options, attemptCount } = harness([new TypeError('fetch failed')]);

    const result = await probe(request, options);

    expect(result).toEqual({
      kind: 'unavailable',
      reason: `fetch failed after ${MAX_ATTEMPTS} attempts`,
    });
    expect(attemptCount()).toBe(MAX_ATTEMPTS);
  });

  it('recovers from a transport fault that clears on a later attempt', async () => {
    const { request, options } = harness([
      new TypeError('fetch failed'),
      new Response('{}', { status: 200 }),
    ]);

    const result = await probe(request, options);

    expect(result.kind).toBe('response');
  });

  it('names a non-Error rejection rather than reporting "undefined"', async () => {
    // A bare string rejection is not idiomatic, which is exactly why it is pinned: undici and the
    // agents beneath it are third-party, and `String(error)` is the only thing that holds for
    // whatever they choose to throw.
    // eslint-disable-next-line @typescript-eslint/prefer-promise-reject-errors -- modelling a badly-behaved third party is the point
    const request = (): Promise<Response> => Promise.reject('socket hang up');
    const sleep = (): Promise<void> => Promise.resolve();

    const result = await probe(request, { sleep });

    expect(result).toEqual({
      kind: 'unavailable',
      reason: `socket hang up after ${MAX_ATTEMPTS} attempts`,
    });
  });

  it('holds a ceiling low enough that a weekly job never sits on one request', () => {
    expect(RETRY_AFTER_CEILING_MS).toBeLessThanOrEqual(60_000);
  });
});

describe('aggregating a run of many checks', () => {
  it('reports conforms only when every check conformed', () => {
    expect(worstOutcome(['conforms', 'conforms'])).toBe('conforms');
  });

  it('reports conforms for a run with nothing to check', () => {
    expect(worstOutcome([])).toBe('conforms');
  });

  it('lets one drift outrank any number of conforming checks', () => {
    expect(worstOutcome(['conforms', 'drift', 'conforms'])).toBe('drift');
  });

  it('lets drift outrank unavailability — a proven violation beats an unproven one', () => {
    expect(worstOutcome(['unavailable', 'drift'])).toBe('drift');
  });

  it('reports unavailable when some checks conformed and the rest were unreachable', () => {
    expect(worstOutcome(['conforms', 'unavailable'])).toBe('unavailable');
  });

  it('maps each outcome to the exit code the workflow routes on', () => {
    expect(DRIFT_EXIT_CODES).toEqual({ conforms: 0, drift: 1, unavailable: 2 });
  });
});
