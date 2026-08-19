import type { HttpClient, HttpRequest, HttpResponse } from './http.js';
import type { Clock } from '../../application/ports/system-ports.js';

/**
 * A short-lived answer cache in front of an {@link HttpClient}, as a decorator so the caching
 * decision is separable from any one provider's conversation and either can be tested without the
 * other. (The cover-art port in the web package is arranged the same way, for the same reason.)
 *
 * Two rules carry the design. Only ANSWERS are remembered — a success, and a provider's own "no
 * such thing" — while a fault is never written, because remembering an outage would turn a passing
 * failure into a lasting one. And identical reads already in flight are served by ONE request:
 * a person typing mints a burst of overlapping URLs, and the second caller of an in-flight read
 * wants that read's answer, not another round trip for it.
 *
 * Keyed by URL alone. Headers are constant per adapter here, so one decorator instance belongs to
 * one adapter — sharing an instance between adapters that identify themselves differently would
 * let one answer stand in for the other's.
 */

export interface HttpCacheConfig {
  /** How long an answer stays fresh. Long enough to cover typing, short enough to stay current. */
  readonly ttlMs?: number;
  /** The ceiling on remembered answers: each pause in someone's typing mints new URLs. */
  readonly maxEntries?: number;
}

const DEFAULT_TTL_MS = 120_000;
const DEFAULT_MAX_ENTRIES = 256;
const NOT_FOUND = 404;

const systemClock: Clock = { now: () => new Date() };

interface Entry {
  readonly at: number;
  readonly response: HttpResponse;
}

/** A provider's answer, as opposed to its failure: what it holds, or that it holds nothing. */
const isAnswer = (response: HttpResponse): boolean =>
  (response.status >= 200 && response.status < 300) || response.status === NOT_FOUND;

export function cachingHttpClient(
  inner: HttpClient,
  config: HttpCacheConfig = {},
  clock: Clock = systemClock,
): HttpClient {
  const ttlMs = config.ttlMs ?? DEFAULT_TTL_MS;
  const maxEntries = config.maxEntries ?? DEFAULT_MAX_ENTRIES;
  // Insertion order is age order, so the first key out is the oldest one.
  const entries = new Map<string, Entry>();
  const inFlight = new Map<string, Promise<HttpResponse>>();

  const fresh = (url: string): HttpResponse | undefined => {
    const entry = entries.get(url);
    if (entry === undefined) return undefined;
    if (clock.now().getTime() - entry.at > ttlMs) {
      entries.delete(url);
      return undefined;
    }
    return entry.response;
  };

  const remember = (url: string, response: HttpResponse): void => {
    entries.delete(url);
    entries.set(url, { at: clock.now().getTime(), response });
    for (const oldest of entries.keys()) {
      if (entries.size <= maxEntries) break;
      entries.delete(oldest);
    }
  };

  return {
    async send(request: HttpRequest): Promise<HttpResponse> {
      // Only a read is cacheable, and only a read may be shared between callers.
      if ((request.method ?? 'GET') !== 'GET') return inner.send(request);

      const held = fresh(request.url);
      if (held !== undefined) return held;

      const existing = inFlight.get(request.url);
      if (existing !== undefined) return existing;

      const pending = (async (): Promise<HttpResponse> => {
        try {
          const response = await inner.send(request);
          if (isAnswer(response)) remember(request.url, response);
          return response;
        } finally {
          // Cleared however the read ends: a failure left in this map would make one outage the
          // permanent answer for that URL.
          inFlight.delete(request.url);
        }
      })();
      inFlight.set(request.url, pending);
      return pending;
    },
  };
}
