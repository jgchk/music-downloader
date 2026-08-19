import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { Readiness } from '$lib/server/runtime.js';
import { GET } from './+server.js';

/**
 * The `GET /health` route (design D1–D3, web-ui spec): a readiness probe composing the server-layer
 * readiness snapshot into a JSON response. `200`/`ok` when both modules are up, `503`/`degraded`
 * when any is down — the body always enumerates each module so a degraded response names the
 * culprit. The route reads only the `$lib/server` surface (mocked here); it imports no module
 * internals, scans no event store, and calls no third party — errors are values, no try/catch.
 */

const { readinessOf, bootedRuntimes } = vi.hoisted(() => ({
  readinessOf: vi.fn<() => Readiness>(),
  bootedRuntimes: vi.fn((): unknown => ({})),
}));
vi.mock('$lib/server/runtime.js', () => ({ readinessOf, bootedRuntimes }));

function invoke(): Response {
  // The handler ignores the event; an empty stub typed to the route's expected shape suffices.
  return GET({} as Parameters<typeof GET>[0]) as Response;
}

describe('GET /health', () => {
  beforeEach(() => {
    readinessOf.mockClear();
    bootedRuntimes.mockReturnValue({});
  });

  it('answers a probe that arrives before the daemon has booted, rather than crashing', async () => {
    // Which is what a readiness probe is FOR: "not ready yet" is a reading, and a crash is not.
    bootedRuntimes.mockReturnValue(undefined);

    const response = invoke();

    expect(response.status).toBe(503);
    expect(await response.json()).toMatchObject({ status: 'degraded' });
    expect(readinessOf).not.toHaveBeenCalled();
  });

  it('returns 200 and ok with the version when both modules are up', async () => {
    readinessOf.mockReturnValue({
      status: 'ok',
      version: '9.9.9',
      modules: { downloader: { status: 'up' }, importer: { status: 'up' } },
    });

    const response = invoke();

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({
      status: 'ok',
      version: '9.9.9',
      modules: { downloader: { status: 'up' }, importer: { status: 'up' } },
    });
  });

  it('returns 503 and degraded, naming the down module', async () => {
    readinessOf.mockReturnValue({
      status: 'degraded',
      version: '9.9.9',
      modules: { downloader: { status: 'up' }, importer: { status: 'down' } },
    });

    const response = invoke();

    expect(response.status).toBe(503);
    const body = (await response.json()) as Readiness;
    expect(body.status).toBe('degraded');
    expect(body.modules.importer.status).toBe('down');
  });

  it('answers from the server-layer snapshot alone — one read, nothing else', async () => {
    readinessOf.mockReturnValue({
      status: 'ok',
      version: '9.9.9',
      modules: { downloader: { status: 'up' }, importer: { status: 'up' } },
    });

    const response = invoke();

    // The body is exactly the injected snapshot: no event-store scan, no module-internal reach.
    expect(readinessOf).toHaveBeenCalledOnce();
    expect(await response.json()).toEqual(readinessOf.mock.results[0]!.value);
  });
});
