import type { z } from 'zod';
import {
  DRIFT_EXIT_CODES,
  probe,
  worstOutcome,
  type DriftOutcome,
  type ProbeResult,
} from '../../../../../scripts/drift/probe.js';
import { PLEX_CLIENT_IDENTIFIER, PLEX_PRODUCT } from '../../../src/lib/server/plex/identity.js';
import { plexPinCheckSchema, plexPinCreateSchema } from '../../../src/lib/server/plex/schemas.js';

/**
 * plex.tv drift detection (external-api-contracts, design D8): live-replays ONLY the
 * unauthenticated PIN operations and validates the responses against the shared consumed-surface
 * schemas. The token-requiring operations (/user, /resources) are deliberately NOT drift-checked —
 * doing so would require storing a long-lived Plex credential, the exact thing the access design
 * refuses to hold; their drift surfaces as fail-closed login failures instead.
 *
 * The exit code carries the run's worst outcome (change: drift-signal-fidelity): `0` conforms,
 * `1` drift, `2` unavailable. Until that change this script reported *any* non-2xx as DRIFT, so a
 * plex.tv 502 would have filed the same false tracking issue that a MusicBrainz 503 filed as #184.
 * A status that means "not now" is unavailability; a status that means the consumed surface
 * changed — a removed operation, or an anonymous one that grew an auth requirement — is drift.
 */

const BASE = process.env.PLEX_API_BASE_URL ?? 'https://plex.tv/api/v2';

const HEADERS = {
  Accept: 'application/json',
  'X-Plex-Product': PLEX_PRODUCT,
  'X-Plex-Client-Identifier': PLEX_CLIENT_IDENTIFIER,
};

const outcomes: DriftOutcome[] = [];

function reportDrift(operation: string, error: z.ZodError | string): void {
  outcomes.push('drift');
  const detail = typeof error === 'string' ? error : JSON.stringify(error.issues, undefined, 2);
  console.error(`DRIFT ${operation}: ${detail}`);
}

function reportUnavailable(operation: string, reason: string): void {
  outcomes.push('unavailable');
  console.error(`UNAVAILABLE ${operation}: ${reason}`);
}

/** A non-JSON 2xx (captive portal, CDN interstitial) is drift too, not an unhandled crash. */
async function jsonBody(operation: string, response: Response): Promise<unknown> {
  try {
    return await response.json();
  } catch {
    reportDrift(operation, 'response body is not JSON');
    return undefined;
  }
}

/**
 * Probe an operation that must answer 2xx, returning the response or `undefined` once the outcome
 * has been recorded. `undefined` deliberately conflates "unavailable" and "drift" for the caller:
 * both mean there is no body to read, and which of the two it was is already in `outcomes`.
 */
async function reachable(
  operation: string,
  request: () => Promise<Response>,
): Promise<Response | undefined> {
  const result: ProbeResult = await probe(request);
  if (result.kind === 'unavailable') {
    reportUnavailable(operation, result.reason);
    return undefined;
  }
  if (!result.response.ok) {
    reportDrift(operation, `unexpected status ${result.response.status}`);
    return undefined;
  }
  return result.response;
}

async function main(): Promise<void> {
  // 1. PIN create — the login flow's first live call.
  const pinCreateResponse = await reachable('pin create', () =>
    fetch(`${BASE}/pins?strong=true`, { method: 'POST', headers: HEADERS }),
  );
  if (pinCreateResponse === undefined) return;
  const createBody = await jsonBody('pin create', pinCreateResponse);
  if (createBody === undefined) return;
  const created = plexPinCreateSchema.safeParse(createBody);
  if (!created.success) {
    reportDrift('pin create', created.error);
    return;
  }
  outcomes.push('conforms');
  console.log('ok: pin create conforms');

  // 2. PIN check (pending) — same shape the callback consumes.
  const checkResponse = await reachable('pin check', () =>
    fetch(`${BASE}/pins/${created.data.id}`, { headers: HEADERS }),
  );
  if (checkResponse !== undefined) {
    const checkBody = await jsonBody('pin check', checkResponse);
    if (checkBody !== undefined) {
      const checked = plexPinCheckSchema.safeParse(checkBody);
      if (checked.success) {
        outcomes.push('conforms');
        console.log('ok: pin check conforms');
      } else {
        reportDrift('pin check', checked.error);
      }
    }
  }

  // 3. Nonexistent PIN — the expired outcome must stay a 404. Here the 404 IS the contract, so it
  // is asserted rather than classified: `probe` never retries it, and a 200 or a 401 in its place
  // would be the drift.
  const gone = await probe(() => fetch(`${BASE}/pins/999999999`, { headers: HEADERS }));
  if (gone.kind === 'unavailable') {
    reportUnavailable('pin check (nonexistent)', gone.reason);
  } else if (gone.response.status === 404) {
    outcomes.push('conforms');
    console.log('ok: nonexistent pin still answers 404');
  } else {
    reportDrift('pin check (nonexistent)', `expected 404, got ${gone.response.status}`);
  }
}

try {
  await main();
} catch (error) {
  // Whatever escapes is a broken checker, not a provider outage — and a broken checker is exactly
  // what #110 was, so it stays in the loud channel rather than the quiet one.
  reportDrift('drift run', error instanceof Error ? error.message : String(error));
}

const outcome = worstOutcome(outcomes);
if (outcome === 'conforms') {
  console.log('plex.tv consumed surface: no drift detected');
} else if (outcome === 'unavailable') {
  console.log(
    'plex.tv was not fully reachable — the consumed surface is neither confirmed nor refuted',
  );
}
process.exit(DRIFT_EXIT_CODES[outcome]);
