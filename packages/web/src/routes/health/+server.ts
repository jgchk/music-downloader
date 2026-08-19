import { json } from '@sveltejs/kit';
import { version } from '$lib/server/version.js';
import { bootedRuntimes, readinessOf } from '$lib/server/runtime.js';
import type { Readiness } from '$lib/server/runtime.js';
import type { RequestHandler } from './$types';

/**
 * `GET /health` — the machine-readable readiness probe (design D1–D3, web-ui spec). It composes the
 * server-layer readiness snapshot (`$lib/server` only — no module internals, no event-store scan,
 * no third-party call) into a JSON body: `200`/`ok` when every module runtime is up, `503`/
 * `degraded` when any booted module reports down (the body always enumerates each module so the
 * culprit is named). Errors are values here — there is no try/catch swallowing.
 */
export const GET: RequestHandler = () => {
  const booted = bootedRuntimes();
  // A probe that arrives before the init hook, after shutdown, or after a failed boot is answered
  // rather than crashed on — that reading is what a probe is for, and the gate lets this one route
  // through unbooted so the answer keeps this body's shape instead of the gate's plain text.
  if (booted === undefined) {
    const readiness: Readiness = {
      status: 'degraded',
      version,
      modules: { downloader: { status: 'down' }, importer: { status: 'down' } },
    };
    return json(readiness, { status: 503 });
  }
  const readiness = readinessOf(booted);
  return json(readiness, { status: readiness.status === 'ok' ? 200 : 503 });
};
