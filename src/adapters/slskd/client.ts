import { fetchHttpClient } from '../support/http.js';
import type { HttpClient } from '../support/http.js';

/**
 * A thin slskd REST client over the shared {@link HttpClient} seam (D14 — unit-tested against a
 * fake router, no live slskd in CI). It centralizes the base URL and `X-API-Key` auth header and
 * turns any non-2xx status into a thrown error, which the adapters map to an `InfraError`. The
 * API key is auth material and never logged (redacted by the pino config, D15).
 */

const DEFAULT_BASE_URL = 'http://localhost:5030';

export interface SlskdConfig {
  readonly baseUrl?: string;
  readonly apiKey?: string;
  /** Delay between poll rounds for search completion and transfer progress. */
  readonly pollIntervalMs?: number;
  /** How long to wait for a search to complete before reading whatever responses arrived. */
  readonly searchTimeoutMs?: number;
}

export class SlskdClient {
  private readonly baseUrl: string;
  private readonly apiKey: string;

  constructor(
    private readonly http: HttpClient = fetchHttpClient,
    config: SlskdConfig = {},
  ) {
    this.baseUrl = config.baseUrl ?? DEFAULT_BASE_URL;
    this.apiKey = config.apiKey ?? '';
  }

  get(path: string): Promise<unknown> {
    return this.request('GET', path);
  }

  /** `GET /api/v0/events` — the newest-first, paginated activity log (used to resolve staged paths). */
  events(offset: number, limit: number): Promise<unknown> {
    return this.get(`/api/v0/events?offset=${offset}&limit=${limit}`);
  }

  /** `GET /api/v0/options` — slskd's effective configuration (used to read the downloads root). */
  options(): Promise<unknown> {
    return this.get('/api/v0/options');
  }

  post(path: string, body: unknown): Promise<unknown> {
    return this.request('POST', path, body);
  }

  del(path: string): Promise<unknown> {
    return this.request('DELETE', path);
  }

  /**
   * DELETE a resource, treating a 404 (already absent) as success — the resource is in the desired
   * end state, so cancel+remove is idempotent. Any other non-2xx still throws. Used for the removals
   * where "already gone" must converge rather than error (settled-transfer cleanup, the sweep).
   */
  async delIfPresent(path: string): Promise<void> {
    const response = await this.dispatch('DELETE', path);
    if (response.status === 404) return;
    if (response.status < 200 || response.status >= 300) {
      throw new Error(`slskd responded ${response.status} for DELETE ${path}`);
    }
  }

  private async request(
    method: 'GET' | 'POST' | 'DELETE',
    path: string,
    body?: unknown,
  ): Promise<unknown> {
    const response = await this.dispatch(method, path, body);
    if (response.status < 200 || response.status >= 300) {
      throw new Error(`slskd responded ${response.status} for ${method} ${path}`);
    }
    return response.body === '' ? undefined : JSON.parse(response.body);
  }

  private dispatch(
    method: 'GET' | 'POST' | 'DELETE',
    path: string,
    body?: unknown,
  ): Promise<{ status: number; body: string }> {
    return this.http.send({
      method,
      url: `${this.baseUrl}${path}`,
      headers: {
        'X-API-Key': this.apiKey,
        'Content-Type': 'application/json',
        Accept: 'application/json',
      },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    });
  }
}
