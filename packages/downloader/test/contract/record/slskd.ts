import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { CONTRACT_FIXTURE_ROOT, type ContractFixture } from '../support/fixture.js';

/**
 * Records slskd contract fixtures from a live instance (task 2.2). It runs a real search, enqueues
 * one real transfer to capture the genuine per-user download payload shape (the nested
 * `directories[].files[]` that a hand-written stub once got wrong), then abandons that transfer to
 * clean up. Credentials come from the environment and are never committed:
 *
 *   SLSKD_BASE_URL=http://host:5030 SLSKD_API_KEY=… pnpm tsx test/contract/record/slskd.ts
 *
 * Everything captured is passed through {@link sanitize} before writing: real Soulseek usernames
 * become peerN and the per-peer share-alias prefix (`@@xxxx\`) becomes `@@share\`, leaving only the
 * public music metadata (artist / album / filename). Review the printed summary before committing.
 */

const BASE_URL = process.env.SLSKD_BASE_URL;
const API_KEY = process.env.SLSKD_API_KEY;
const OUT_DIR = join(CONTRACT_FIXTURE_ROOT, 'slskd');
const SEARCH_TEXT = 'Pink Floyd Dark Side of the Moon';
// A live search returns hundreds of peers (~MBs). Keep a handful of real, unaltered peer objects —
// enough to pin the contract shape without bloating the repo. The drop is logged, never silent.
const PEER_CAP = 5;
// One page of the newest-first events log — enough to capture a recent DownloadFileComplete.
const EVENTS_LIMIT = 100;

if (BASE_URL === undefined || API_KEY === undefined) {
  throw new Error('SLSKD_BASE_URL and SLSKD_API_KEY must be set');
}

const capturedAt = new Date().toISOString().slice(0, 10);
const usernameMap = new Map<string, string>();

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/** Anonymize a username to a stable `peerN` alias (first-seen order). */
function alias(username: string): string {
  const existing = usernameMap.get(username);
  if (existing !== undefined) return existing;
  const next = `peer${usernameMap.size + 1}`;
  usernameMap.set(username, next);
  return next;
}

/** Recursively strip PII from a captured payload: usernames → peerN, share-token prefixes. */
function sanitize(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(sanitize);
  if (value !== null && typeof value === 'object') {
    return Object.fromEntries(
      Object.entries(value).map(([key, val]) => {
        if (key === 'username' && typeof val === 'string') return [key, alias(val)];
        return [key, sanitize(val)];
      }),
    );
  }
  if (typeof value === 'string') return value.replace(/^@@[^\\]+\\/, '@@share\\');
  return value;
}

async function call(
  method: 'GET' | 'POST' | 'DELETE',
  path: string,
  body?: unknown,
): Promise<{ status: number; body: unknown }> {
  const response = await fetch(`${BASE_URL}${path}`, {
    method,
    headers: {
      'X-API-Key': API_KEY!,
      'Content-Type': 'application/json',
      Accept: 'application/json',
    },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
  const text = await response.text();
  return { status: response.status, body: text === '' ? undefined : JSON.parse(text) };
}

function fixture(
  request: ContractFixture['request'],
  raw: { status: number; body: unknown },
  note: string,
): ContractFixture {
  return {
    // Deliberately non-identifying — don't embed the maintainer's instance host in committed data.
    provenance: { source: 'live slskd instance', capturedAt, serviceVersion: '0.22.5.0', note },
    request: { ...request, path: sanitize(request.path) as string },
    response: { status: raw.status, body: sanitize(raw.body) },
  };
}

function write(name: string, f: ContractFixture): void {
  writeFileSync(join(OUT_DIR, name), `${JSON.stringify(f, null, 2)}\n`);
  console.log(`wrote slskd/${name} (${f.response.status})`);
}

interface Response {
  username?: string;
  files?: { filename?: string; size?: number }[];
}

async function main(): Promise<void> {
  mkdirSync(OUT_DIR, { recursive: true });

  const create = await call('POST', '/api/v0/searches', { searchText: SEARCH_TEXT });
  const searchId = (create.body as { id?: string }).id;
  if (searchId === undefined) throw new Error('search create returned no id');
  write(
    'search-create.json',
    fixture({ method: 'POST', path: '/api/v0/searches' }, create, 'search creation'),
  );

  for (let i = 0; i < 15; i += 1) {
    await sleep(1000);
    const state = await call('GET', `/api/v0/searches/${searchId}`);
    if ((state.body as { isComplete?: boolean }).isComplete === true) {
      write(
        'search-state.json',
        fixture({ method: 'GET', path: `/api/v0/searches/${searchId}` }, state, 'completed search'),
      );
      break;
    }
  }

  const responses = await call('GET', `/api/v0/searches/${searchId}/responses`);
  const allPeers = responses.body as Response[];
  const keptPeers = allPeers.slice(0, PEER_CAP);
  if (allPeers.length > PEER_CAP) {
    console.log(`capped search responses: kept ${PEER_CAP} of ${allPeers.length} peers`);
  }
  write(
    'search-responses.json',
    fixture(
      { method: 'GET', path: `/api/v0/searches/${searchId}/responses` },
      { status: responses.status, body: keptPeers },
      `per-peer search responses (kept ${keptPeers.length} of ${allPeers.length} peers)`,
    ),
  );

  // Pick a kept peer with a flac file and enqueue one transfer to capture the download payload.
  const peers = keptPeers.filter((r) =>
    (r.files ?? []).some((f) => f.filename?.toLowerCase().endsWith('.flac')),
  );
  const peer = peers[0];
  const file = (peer?.files ?? []).find((f) => f.filename?.toLowerCase().endsWith('.flac'));
  if (peer?.username === undefined || file?.filename === undefined) {
    throw new Error('no enqueueable flac candidate found — re-run for transfer fixtures');
  }
  const realUser = peer.username;

  const enqueue = await call(
    'POST',
    `/api/v0/transfers/downloads/${encodeURIComponent(realUser)}`,
    [{ filename: file.filename, size: file.size ?? 0 }],
  );
  write(
    'transfers-enqueue.json',
    fixture(
      { method: 'POST', path: `/api/v0/transfers/downloads/${alias(realUser)}` },
      enqueue,
      'download enqueue',
    ),
  );

  await sleep(1500);
  const poll = await call('GET', `/api/v0/transfers/downloads/${encodeURIComponent(realUser)}`);
  write(
    'transfers-poll.json',
    fixture(
      { method: 'GET', path: `/api/v0/transfers/downloads/${alias(realUser)}` },
      poll,
      'per-user download transfers (nested directories[].files[])',
    ),
  );

  // The effective configuration: only directories.downloads (the downloads root) is consumed, used
  // to re-root slskd's container-side localFilename onto our shared staging volume.
  const options = await call('GET', '/api/v0/options');
  write(
    'options.json',
    fixture(
      { method: 'GET', path: '/api/v0/options' },
      options,
      'GET /api/v0/options — only directories.downloads is consumed (the downloads root)',
    ),
  );

  // The newest-first, paged activity log with its real offset/limit query. Each record's `data` is a
  // JSON-encoded string; a `DownloadFileComplete` carries the authoritative localFilename + transfer
  // id the staged-path resolver decodes. A completion only appears once a download has finished, so
  // run this recorder against an instance that has completed at least one download for full coverage.
  // NOTE: the committed events.json/options.json fixtures predate this recorder capture (they were
  // hand-maintained), so their `request` blocks lack the `query` recorded here. Re-record both against
  // a live slskd instance on the next slskd pin bump to make the recorder byte-faithful to them; the
  // decode/request-shape tests are unaffected in the meantime (the fixture server captures the real
  // outbound request, not the fixture file).
  const events = await call('GET', `/api/v0/events?offset=0&limit=${EVENTS_LIMIT}`);
  write(
    'events.json',
    fixture(
      {
        method: 'GET',
        path: '/api/v0/events',
        query: { offset: '0', limit: String(EVENTS_LIMIT) },
      },
      events,
      'GET /api/v0/events — newest-first paged log; DownloadFileComplete.data is a JSON-encoded string',
    ),
  );

  // Clean up: abandon every transfer we just enqueued for this peer.
  const dirs = (poll.body as { directories?: { files?: { id?: string }[] }[] }).directories ?? [];
  for (const dir of dirs) {
    for (const t of dir.files ?? []) {
      if (t.id !== undefined) {
        await call('DELETE', `/api/v0/transfers/downloads/${encodeURIComponent(realUser)}/${t.id}`);
        console.log(`abandoned transfer ${t.id}`);
      }
    }
  }
  console.log(`\nusername aliases: ${JSON.stringify(Object.fromEntries(usernameMap))}`);
}

void main();
