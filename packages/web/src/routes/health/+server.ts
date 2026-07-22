import { json } from '@sveltejs/kit';
import { readinessOf } from '$lib/server/runtime.js';
import type { RequestHandler } from './$types';

/**
 * `GET /health` — the machine-readable readiness probe (design D1–D3, web-ui spec). It composes the
 * server-layer readiness snapshot (`$lib/server` only — no module internals, no event-store scan,
 * no third-party call) into a JSON body: `200`/`ok` when every module runtime is up, `503`/
 * `degraded` when any booted module reports down (the body always enumerates each module so the
 * culprit is named). Errors are values here — there is no try/catch swallowing.
 */
export const GET: RequestHandler = () => {
  const readiness = readinessOf();
  return json(readiness, { status: readiness.status === 'ok' ? 200 : 503 });
};
