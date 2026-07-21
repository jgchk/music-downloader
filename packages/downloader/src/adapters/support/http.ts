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

export const fetchHttpClient: HttpClient = {
  async send({ method = 'GET', url, headers, body }) {
    const response = await fetch(url, { method, headers, body });
    return { status: response.status, body: await response.text() };
  },
};
