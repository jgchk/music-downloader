/**
 * A tiny HTTP seam shared by the network adapters (MusicBrainz, slskd). Keeping it behind an
 * interface lets those adapters be unit-tested against canned responses and recorded fixtures —
 * no live calls in CI (D14) — while the default implementation is a thin wrapper over `fetch`.
 */
export interface HttpRequest {
  readonly method?: 'GET' | 'POST' | 'DELETE';
  readonly url: string;
  readonly headers?: Record<string, string>;
  readonly body?: string;
}

export interface HttpResponse {
  readonly status: number;
  readonly body: string;
}

export interface HttpClient {
  send(request: HttpRequest): Promise<HttpResponse>;
}

// Generous for slow providers, but finite: the reactor dispatches effects serially, so an
// unbounded fetch that never settles freezes the whole drain — every acquisition behind it.
const DEFAULT_TIMEOUT_MS = 30_000;

export function createFetchHttpClient(timeoutMs = DEFAULT_TIMEOUT_MS): HttpClient {
  return {
    async send({ method = 'GET', url, headers, body }) {
      const signal = AbortSignal.timeout(timeoutMs);
      const response = await fetch(url, { method, headers, body, signal });
      return { status: response.status, body: await response.text() };
    },
  };
}

export const fetchHttpClient: HttpClient = createFetchHttpClient();
