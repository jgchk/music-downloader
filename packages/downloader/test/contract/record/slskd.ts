import type { ContractFixture } from '../support/fixture.js';
import {
  PINNED_SLSKD_VERSION,
  assertPinnedVersion,
  createAnonymizer,
  createCaller,
  createWriter,
  projectEvents,
  projectOptions,
  sleep,
} from './slskd-support.js';

/**
 * Records the live-network slskd fixtures — the cross-check the lab cannot fake.
 *
 * The recording lab (`slskd-lab.ts`) produces every transfer *state*, because both ends of a lab
 * transfer are ours. What it cannot produce is the live Soulseek network: a search answered by
 * hundreds of heterogeneous clients (Nicotine+, SoulseekQt, slskd…), whose response shapes are
 * themselves contract data. So this recorder stays, scoped to that: a real search, and one real
 * transfer to confirm the lab's shapes are the network's shapes.
 *
 *   SLSKD_BASE_URL=http://host:5030 SLSKD_API_KEY=… pnpm tsx test/contract/record/slskd.ts
 *
 * It writes into `fixtures/slskd/live/`, and it shares its entire scrub with the lab recorder
 * ({@link createAnonymizer}, {@link projectOptions}, {@link projectEvents}) rather than keeping its
 * own copy. That sharing is not tidiness — this is the recorder whose peers are *real people*. Real
 * usernames become `peerN`, share-alias prefixes become `@@share\`, usernames and IP endpoints
 * appearing inside free-text exception messages are rewritten too, and the two metadata endpoints
 * are projected down to the fields the adapters actually read so Soulseek credentials and peer PII
 * never reach a public repository. Review the printed summary before committing.
 */

const BASE_URL = process.env.SLSKD_BASE_URL;
const API_KEY = process.env.SLSKD_API_KEY;
const SEARCH_TEXT = 'Pink Floyd Dark Side of the Moon';
// A live search returns hundreds of peers (~MBs). Keep a handful of real, unaltered peer objects —
// enough to pin the contract shape without bloating the repo. The drop is logged, never silent.
const PEER_CAP = 5;
// One page of the newest-first events log — enough to capture a recent DownloadFileComplete.
const EVENTS_LIMIT = 100;
// How many DownloadFileComplete events to keep in the fixture — a handful pins the decode/re-root
// contract without bloating the committed file.
const EVENTS_KEPT = 3;

if (BASE_URL === undefined || API_KEY === undefined) {
  throw new Error('SLSKD_BASE_URL and SLSKD_API_KEY must be set');
}

const capturedAt = new Date().toISOString().slice(0, 10);
const { alias, sanitize, aliases } = createAnonymizer();
const call = createCaller(BASE_URL, API_KEY);
const write = createWriter('live');

function envelope(
  request: ContractFixture['request'],
  raw: { status: number; body: unknown },
  note: string,
): ContractFixture {
  return {
    // Deliberately non-identifying — don't embed the maintainer's instance host in committed data.
    provenance: {
      source: 'live slskd instance',
      capturedAt,
      serviceVersion: PINNED_SLSKD_VERSION,
      note,
    },
    request: { ...request, path: sanitize(request.path) as string },
    response: { status: raw.status, body: sanitize(raw.body) },
  };
}

/**
 * A call whose success is a precondition. The lab recorder learned this the hard way; the live one
 * needs it more, because a live enqueue against an offline peer returns a 500 with a rejection body
 * — which would be written into `transfers-enqueue.json`, a fixture the registry declares to be an
 * empty 201 ack and therefore skips schema validation for.
 */
async function expectOk(
  method: 'GET' | 'POST' | 'DELETE',
  path: string,
  body?: unknown,
): Promise<{ status: number; body: unknown }> {
  const capture = await call(method, path, body);
  if (capture.status < 200 || capture.status >= 300) {
    throw new Error(`${method} ${path} → ${capture.status}: ${JSON.stringify(capture.body)}`);
  }
  return capture;
}

interface Response {
  username?: string;
  files?: { filename?: string; size?: number }[];
}

async function main(): Promise<void> {
  // Same guard as the lab: the live instance is the one that actually gets upgraded, so it is the
  // one where stamping fixtures with a version nobody checked is a live hazard rather than a
  // theoretical one. Without it, the "records only fixtures captured from the pinned version" test
  // validates a constant against itself.
  await assertPinnedVersion(call);

  const create = await expectOk('POST', '/api/v0/searches', { searchText: SEARCH_TEXT });
  const searchId = (create.body as { id?: string }).id;
  if (searchId === undefined) throw new Error('search create returned no id');
  write(
    'search-create.json',
    envelope({ method: 'POST', path: '/api/v0/searches' }, create, 'search creation'),
  );

  for (let i = 0; i < 15; i += 1) {
    await sleep(1000);
    const state = await call('GET', `/api/v0/searches/${searchId}`);
    if ((state.body as { isComplete?: boolean }).isComplete === true) {
      write(
        'search-state.json',
        envelope(
          { method: 'GET', path: `/api/v0/searches/${searchId}` },
          state,
          'completed search',
        ),
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
    envelope(
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

  const enqueue = await expectOk(
    'POST',
    `/api/v0/transfers/downloads/${encodeURIComponent(realUser)}`,
    [{ filename: file.filename, size: file.size ?? 0 }],
  );
  write(
    'transfers-enqueue.json',
    envelope(
      { method: 'POST', path: `/api/v0/transfers/downloads/${alias(realUser)}` },
      enqueue,
      'download enqueue',
    ),
  );

  await sleep(1500);
  const poll = await expectOk('GET', `/api/v0/transfers/downloads/${encodeURIComponent(realUser)}`);
  write(
    'transfers-poll.json',
    envelope(
      { method: 'GET', path: `/api/v0/transfers/downloads/${alias(realUser)}` },
      poll,
      'per-user download transfers (nested directories[].files[])',
    ),
  );

  // The effective configuration: only directories.downloads (the downloads root) is consumed, used
  // to re-root slskd's container-side localFilename onto our shared staging volume. Projected to just
  // `directories` so the Soulseek credentials and the rest of the config never reach the fixture.
  const options = await call('GET', '/api/v0/options');
  write(
    'options.json',
    envelope(
      { method: 'GET', path: '/api/v0/options' },
      { status: options.status, body: projectOptions(options.body) },
      'GET /api/v0/options — only directories.downloads is consumed (the downloads root)',
    ),
  );

  // The newest-first, paged activity log with its real offset/limit query. Each record's `data` is a
  // JSON-encoded string; a `DownloadFileComplete` carries the authoritative localFilename + transfer
  // id the staged-path resolver decodes. A completion only appears once a download has finished, so
  // run against an instance that has completed the enqueued transfer above — the lab's `full-flow`
  // scenario is the version of this that regenerates the whole coupled set in one session.
  const events = await call('GET', `/api/v0/events?offset=0&limit=${EVENTS_LIMIT}`);
  write(
    'events.json',
    envelope(
      {
        method: 'GET',
        path: '/api/v0/events',
        query: { offset: '0', limit: String(EVENTS_LIMIT) },
      },
      { status: events.status, body: projectEvents(events.body, EVENTS_KEPT) },
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
  console.log(`\nusername aliases: ${JSON.stringify(aliases())}`);
}

main().catch((error: unknown) => {
  console.error('\nrecording failed — the live fixture set may be left half-rewritten');
  console.error(error);
  process.exitCode = 1;
});
