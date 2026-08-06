import { mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { setTimeout as sleep } from 'node:timers/promises';
import type { ZodType } from 'zod';
import { isServerResource } from '../../../src/lib/server/plex/adapter.js';
import { PLEX_CLIENT_IDENTIFIER, PLEX_PRODUCT } from '../../../src/lib/server/plex/identity.js';
import {
  plexPinCheckSchema,
  plexPinCreateSchema,
  plexResourcesSchema,
  plexUserSchema,
} from '../../../src/lib/server/plex/schemas.js';
import { CONTRACT_FIXTURE_ROOT } from '../support/fixture.js';
import type { ContractFixture } from '../support/fixture.js';

/**
 * Interactive recorder for the consumed plex.tv surface (external-api-contracts, design D8):
 *
 *   pnpm tsx packages/web/test/contract/record/plextv.ts
 *
 * The PIN flow needs a human: the script creates two PINs — one is left UNAPPROVED (the pending
 * fixture), the other you approve at the printed plex.tv link — then captures the authorized
 * check, the account lookup, and the resources listing with the resulting token.
 *
 * SANITIZATION IS THE POINT (slskd-recorder lesson): every response is PROJECTED to the consumed
 * fields before anything is written. The auth token is replaced with a fixed placeholder, the
 * account is pseudonymized (`user1`), and every resource clientIdentifier becomes `machine-N`.
 * The token itself lives only in this process's memory and dies with it. Review the printed
 * summary before committing.
 */

const BASE = process.env.PLEX_API_BASE_URL ?? 'https://plex.tv/api/v2';
const OUT = path.join(CONTRACT_FIXTURE_ROOT, 'plextv');
const TODAY = new Date().toISOString().slice(0, 10);

/** The committed stand-in for the real token — the schema only requires a string. The tier's
 * scrub assertions pin this exact literal, so a fixture carrying anything else fails the gate. */
const SCRUBBED_TOKEN = 'plex-user-token-scrubbed';

const IDENTITY_HEADERS = {
  Accept: 'application/json',
  'X-Plex-Product': PLEX_PRODUCT,
  'X-Plex-Client-Identifier': PLEX_CLIENT_IDENTIFIER,
};

function write(name: string, fixture: ContractFixture): void {
  writeFileSync(path.join(OUT, name), `${JSON.stringify(fixture, undefined, 2)}\n`);
  console.log(`  wrote ${name}`);
}

function provenance(note: string): ContractFixture['provenance'] {
  return { source: `${BASE} (live)`, capturedAt: TODAY, note };
}

async function requestJson(
  method: 'GET' | 'POST',
  endpoint: string,
  token?: string,
): Promise<{ status: number; body: unknown }> {
  const response = await fetch(`${BASE}${endpoint}`, {
    method,
    headers:
      token === undefined ? IDENTITY_HEADERS : { ...IDENTITY_HEADERS, 'X-Plex-Token': token },
  });
  const text = await response.text();
  return { status: response.status, body: text === '' ? undefined : JSON.parse(text) };
}

/**
 * A fixture body must be a PROJECTION OF A VALIDATED LIVE RESPONSE, never a fabrication: the
 * token-requiring operations are replay-only (no scheduled drift, design D8), so re-recording is
 * the only moment IN THE DEVELOPMENT LOOP their schemas meet real wire data (production logins
 * meet it too, but fail closed) — a recorder that writes a template would mask exactly the drift
 * this tier exists to catch. Validate first, abort loudly on a violation or unexpected status,
 * and only then pseudonymize the parsed values.
 */
function validated<T>(
  operation: string,
  response: { status: number; body: unknown },
  schema: ZodType<T>,
): T {
  if (response.status < 200 || response.status >= 300) {
    throw new Error(`${operation} answered ${response.status} — fixture NOT written`);
  }
  const parsed = schema.safeParse(response.body);
  if (!parsed.success) {
    throw new Error(
      `${operation} violated the consumed schema — live drift; fixture NOT written: ${JSON.stringify(parsed.error.issues)}`,
    );
  }
  return parsed.data;
}

async function main(): Promise<void> {
  mkdirSync(OUT, { recursive: true });

  // 1. The pending PIN: created and checked once, never approved.
  console.log('── creating the never-approved PIN (pending fixture)');
  const pendingCreate = await requestJson('POST', '/pins?strong=true');
  const pending = validated('pin create (pending)', pendingCreate, plexPinCreateSchema);
  const pendingCheck = await requestJson('GET', `/pins/${pending.id}`);
  const pendingChecked = validated('pin check (pending)', pendingCheck, plexPinCheckSchema);
  if (pendingChecked.authToken != null) throw new Error('pending pin unexpectedly authorized');
  write('pin-check-pending.json', {
    provenance: provenance('projected to consumed fields; PIN never approved'),
    request: { method: 'GET', path: `/pins/${pending.id}` },
    response: { status: pendingCheck.status, body: { id: pendingChecked.id, authToken: null } },
  });

  // 2. An id no PIN ever had: the expired/unknown outcome.
  console.log('── checking a nonexistent PIN (expired fixture)');
  const gone = await requestJson('GET', '/pins/999999999');
  if (gone.status !== 404)
    throw new Error(`expected 404 for a nonexistent pin, got ${gone.status}`);
  write('pin-check-expired.json', {
    provenance: provenance('nonexistent pin id; body not consumed (adapter reads the status)'),
    request: { method: 'GET', path: '/pins/999999999' },
    response: { status: 404, body: {} },
  });

  // 3. The PIN you approve: its create response is THE pin-create fixture.
  console.log('── creating the PIN to approve (pin-create + authorized fixtures)');
  const create = await requestJson('POST', '/pins?strong=true');
  const pin = validated('pin create', create, plexPinCreateSchema);
  write('pin-create.json', {
    provenance: provenance('projected to consumed fields (id, code)'),
    request: { method: 'POST', path: '/pins', query: { strong: 'true' } },
    response: { status: create.status, body: { id: pin.id, code: pin.code } },
  });

  const authUrl = `https://app.plex.tv/auth#?clientID=${PLEX_CLIENT_IDENTIFIER}&code=${pin.code}&context%5Bdevice%5D%5Bproduct%5D=${PLEX_PRODUCT}`;
  console.log('\n►► approve the PIN in a browser (any account shared with the server works):');
  console.log(`   ${authUrl}\n`);

  // The human pause: poll the PIN until it is approved (or the ~10-minute budget runs out).
  const deadline = Date.now() + 10 * 60 * 1000;
  let approved: { status: number; id: number; token: string } | undefined;
  while (approved === undefined) {
    if (Date.now() >= deadline) throw new Error('pin was not approved within 10 minutes');
    await sleep(5000);
    const check = await requestJson('GET', `/pins/${pin.id}`);
    const body = validated('pin check (approved)', check, plexPinCheckSchema);
    if (body.authToken != null && body.authToken !== '') {
      approved = { status: check.status, id: body.id, token: body.authToken };
    } else {
      console.log('  …still waiting for approval');
    }
  }
  const token = approved.token;
  write('pin-check-authorized.json', {
    provenance: provenance('projected to consumed fields; REAL TOKEN REPLACED with placeholder'),
    request: { method: 'GET', path: `/pins/${pin.id}` },
    response: { status: approved.status, body: { id: approved.id, authToken: SCRUBBED_TOKEN } },
  });

  // 4. Account + resources with the token — held in memory only, never written. The bodies are
  // schema-validated LIVE data, pseudonymized field-by-field: which fields were present (and
  // their null-ness) is preserved from the wire; only the values are replaced.
  console.log('── capturing account + resources (validated, then pseudonymized)');
  const userResponse = await requestJson('GET', '/user', token);
  const user = validated('user lookup', userResponse, plexUserSchema);
  write('user.json', {
    provenance: provenance(
      'validated live body projected to consumed fields; account pseudonymized to user1',
    ),
    request: { method: 'GET', path: '/user' },
    response: {
      status: userResponse.status,
      body: {
        id: 1,
        // Preserve wire null-ness/absence so the adapter's username fallback chain keeps
        // real-data grounding across re-records.
        ...(user.username !== undefined && { username: user.username === null ? null : 'user1' }),
        ...(user.title !== undefined && { title: user.title === null ? null : 'user1' }),
      },
    },
  });

  const resourcesResponse = await requestJson('GET', '/resources', token);
  const resources = validated('resources', resourcesResponse, plexResourcesSchema);
  // The consumed fields are now three: the identifier (pseudonymized), `provides` (the capability
  // list the predicate reads — kept VERBATIM, it is plex.tv's vocabulary and carries nothing
  // about the account), and `owned` (the role source — a boolean, likewise not identifying).
  // Presence/absence of both is preserved from the wire so the tolerant defaults keep their
  // real-data grounding across re-records.
  const projected = resources.map((entry, index) => ({
    clientIdentifier: `machine-${index + 1}`,
    ...(entry.provides !== undefined && { provides: entry.provides }),
    ...(entry.owned !== undefined && { owned: entry.owned }),
  }));
  if (projected.length === 0)
    throw new Error('no resources with a clientIdentifier — token account sees no devices');
  // Asked with the PRODUCTION predicate: a listing the adapter would grant on must never be
  // refused by the recorder (a case-sensitive copy here would abort a legitimate re-record).
  if (projected.every((entry) => !isServerResource(entry.provides)))
    throw new Error(
      'no resource declares provides=server — the recording cannot witness a membership grant',
    );
  write('resources.json', {
    provenance: provenance(
      `validated live body projected to consumed fields; ${projected.length} clientIdentifiers pseudonymized to machine-N, provides/owned verbatim`,
    ),
    request: { method: 'GET', path: '/resources' },
    response: { status: resourcesResponse.status, body: projected },
  });

  console.log('\n── done. Review the fixtures before committing:');
  console.log(`   ${OUT}`);
  console.log('   (no token, no account data, no real machine ids should appear anywhere)');
}

await main();
