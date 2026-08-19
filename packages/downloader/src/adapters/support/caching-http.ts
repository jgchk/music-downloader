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
 * Keyed by the URL AND the headers the request carries. Two adapters on this seam identify
 * themselves differently — one sends an API key — so a URL-only key would let one adapter's answer
 * be served to the other's request if a single instance were ever shared between them. The key
 * makes that impossible rather than leaving it to whoever wires the composition root next.
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

/** What identifies one read: where it goes, and what it says about itself on the way. */
const keyOf = (request: HttpRequest): string =>
  `${request.url}\u{0}${Object.entries(request.headers ?? {})
    .toSorted(([left], [right]) => left.localeCompare(right))
    .map(([name, value]) => `${name}:${value}`)
    .join('\u{0}')}`;

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
  // Insertion order is recency order — a hit re-inserts — so the first key out is the least
  // recently used one, which is what a Map's iteration order gives for free.
  const entries = new Map<string, Entry>();
  const inFlight = new Map<string, Promise<HttpResponse>>();

  const fresh = (key: string): HttpResponse | undefined => {
    const entry = entries.get(key);
    if (entry === undefined) return undefined;
    if (clock.now().getTime() - entry.at > ttlMs) {
      entries.delete(key);
      return undefined;
    }
    entries.delete(key);
    entries.set(key, entry);
    return entry.response;
  };

  const remember = (key: string, response: HttpResponse): void => {
    entries.delete(key);
    entries.set(key, { at: clock.now().getTime(), response });
    for (const oldest of entries.keys()) {
      if (entries.size <= maxEntries) break;
      entries.delete(oldest);
    }
  };

  return {
    async send(request: HttpRequest): Promise<HttpResponse> {
      // Only a read is cacheable, and only a read may be shared between callers.
      if ((request.method ?? 'GET') !== 'GET') return inner.send(request);

      const key = keyOf(request);
      const held = fresh(key);
      if (held !== undefined) return held;

      const existing = inFlight.get(key);
      if (existing !== undefined) return existing;

      // Wrapped in an async call before anything reads it, so a client that throws SYNCHRONOUSLY
      // — legal against `HttpClient`, whose `send` is only typed as returning a promise — becomes
      // a rejection like any other rather than escaping past the bookkeeping below.
      const pending = (async (): Promise<HttpResponse> => inner.send(request))();
      // Recorded BEFORE the first await: were the delete to run first, the rejected promise would
      // then be written in and never removed, making one outage the permanent answer for this URL.
      inFlight.set(key, pending);
      try {
        const response = await pending;
        if (isAnswer(response)) remember(key, response);
        return response;
      } finally {
        inFlight.delete(key);
      }
    },
  };
}
