import { z } from 'zod';
import { PLEX_CLIENT_IDENTIFIER, PLEX_PRODUCT } from '../../../src/lib/server/plex/identity.js';
import { plexPinCheckSchema, plexPinCreateSchema } from '../../../src/lib/server/plex/schemas.js';

/**
 * plex.tv drift detection (external-api-contracts, design D8): live-replays ONLY the
 * unauthenticated PIN operations and validates the responses against the shared consumed-surface
 * schemas. The token-requiring operations (/user, /resources) are deliberately NOT drift-checked —
 * doing so would require storing a long-lived Plex credential, the exact thing the access design
 * refuses to hold; their drift surfaces as fail-closed login failures instead. Exits non-zero on
 * drift; the workflow turns that into the single contract-drift issue.
 */

const BASE = process.env['PLEX_API_BASE_URL'] ?? 'https://plex.tv/api/v2';

const HEADERS = {
  Accept: 'application/json',
  'X-Plex-Product': PLEX_PRODUCT,
  'X-Plex-Client-Identifier': PLEX_CLIENT_IDENTIFIER,
};

let failed = false;

function report(operation: string, error: z.ZodError | string): void {
  failed = true;
  const detail = typeof error === 'string' ? error : JSON.stringify(error.issues, undefined, 2);
  console.error(`DRIFT ${operation}: ${detail}`);
}

/** A non-JSON 2xx (captive portal, CDN interstitial) is drift too, not an unhandled crash. */
async function jsonBody(operation: string, response: Response): Promise<unknown | undefined> {
  try {
    return await response.json();
  } catch {
    report(operation, 'response body is not JSON');
    return undefined;
  }
}

async function main(): Promise<void> {
  // 1. PIN create — the login flow's first live call.
  const createResponse = await fetch(`${BASE}/pins?strong=true`, {
    method: 'POST',
    headers: HEADERS,
  });
  if (!createResponse.ok) {
    report('pin create', `unexpected status ${createResponse.status}`);
    return;
  }
  const createBody = await jsonBody('pin create', createResponse);
  if (createBody === undefined) return;
  const created = plexPinCreateSchema.safeParse(createBody);
  if (!created.success) {
    report('pin create', created.error);
    return;
  }
  console.log('ok: pin create conforms');

  // 2. PIN check (pending) — same shape the callback consumes.
  const checkResponse = await fetch(`${BASE}/pins/${created.data.id}`, { headers: HEADERS });
  if (!checkResponse.ok) {
    report('pin check', `unexpected status ${checkResponse.status}`);
    return;
  }
  const checkBody = await jsonBody('pin check', checkResponse);
  if (checkBody !== undefined) {
    const checked = plexPinCheckSchema.safeParse(checkBody);
    if (checked.success) {
      console.log('ok: pin check conforms');
    } else {
      report('pin check', checked.error);
    }
  }

  // 3. Nonexistent PIN — the expired outcome must stay a 404.
  const goneResponse = await fetch(`${BASE}/pins/999999999`, { headers: HEADERS });
  if (goneResponse.status === 404) {
    console.log('ok: nonexistent pin still answers 404');
  } else {
    report('pin check (nonexistent)', `expected 404, got ${goneResponse.status}`);
  }
}

try {
  await main();
} catch (error) {
  // Whatever escapes (transport fault mid-run) is still a DRIFT-labelled failure, not a bare stack.
  report('drift run', error instanceof Error ? error.message : String(error));
}
if (failed) process.exit(1);
console.log('plex.tv consumed surface: no drift detected');
