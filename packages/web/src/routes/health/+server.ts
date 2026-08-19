import { json } from '@sveltejs/kit';
import { bootedRuntimes, readinessOf } from '$lib/server/runtime.js';
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
  // A probe that arrives before the init hook (or during shutdown) is answered, not crashed on:
  // "not ready yet" is the honest reading of an unbooted daemon, and it is what a probe is for.
  if (booted === undefined) {
    return json({ status: 'degraded', modules: {} }, { status: 503 });
  }
  const readiness = readinessOf(booted);
  return json(readiness, { status: readiness.status === 'ok' ? 200 : 503 });
};
