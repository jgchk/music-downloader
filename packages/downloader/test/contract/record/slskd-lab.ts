import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import type { ContractFixture } from '../support/fixture.js';
import { statSync } from 'node:fs';
import {
  PINNED_SLSKD_VERSION,
  assertPinnedVersion,
  createAnonymizer,
  createCaller,
  createWriter,
  projectEvents,
  projectOptions,
  sleep,
  type Capture,
} from './slskd-support.js';

/**
 * Records slskd contract fixtures from the local recording lab (change: slskd-contract-truth).
 *
 * The live Soulseek network cannot be made to fail on cue — a peer has to reject, stall, or vanish
 * for us to witness the vocabulary the failure classifier consumes, and no amount of polling makes
 * that deterministic. The lab replaces luck with orchestration: both ends of every transfer are
 * ours, so a slot-starved queue, a cancellation, a rejected file, and a peer that dies mid-flight
 * are all one command each.
 *
 *   packages/downloader/test/contract/lab/seed-corpus.sh
 *   docker compose -f packages/downloader/test/contract/lab/compose.yaml up -d
 *   pnpm --dir packages/downloader tsx test/contract/record/slskd-lab.ts            # every scenario
 *   pnpm --dir packages/downloader tsx test/contract/record/slskd-lab.ts queued     # or a few
 *
 * Each scenario owns one directory under `fixtures/slskd/<scenario>/` and leaves the lab clean for
 * the next, so scenarios compose in any order and a single one can be re-recorded alone. (`offline`
 * is the one that writes two: it records both spellings of an absent peer, into `offline/` and
 * `unreachable/`.) The one
 * exception is deliberate: `full-flow` writes a coupled set (search → enqueue → poll → events)
 * whose fixtures reference each other by transfer id, which is why it is a *scenario* rather than a
 * handful of independent captures — see its comment.
 *
 * This never runs in CI and never points at the production slskd: the recipes stop containers and
 * enqueue deliberately-doomed transfers.
 */

const execFileAsync = promisify(execFile);

const SUT_URL = process.env.SLSKD_LAB_SUT_URL ?? 'http://127.0.0.1:5030';
// The lab peer's invented Soulseek identity — it registers itself with soulfind on first login.
const PEER = 'labpeer';
const LAB_DIR = new URL('../lab/', import.meta.url).pathname;
const SHARE = String.raw`corpus\Lab Artist\Lab Album`;
/** Incompressible noise: at the peer's 1 KiB/s ceiling it holds the single upload slot for a whole recording session (see lab/seed-corpus.sh). */
const HOG_FILE = `${SHARE}\\01 - Slot Hog.flac`;
/** Digital silence — a few KiB, so a success-path transfer settles in seconds. */
const SMALL_FILE = `${SHARE}\\03 - Success Path.flac`;
const QUEUED_FILE = `${SHARE}\\02 - Queued Behind.flac`;

/**
 * The byte size to enqueue for a shared file, read from the corpus at record time.
 *
 * Hardcoding these was a trap: `seed-corpus.sh` synthesizes the files with whatever ffmpeg and
 * libFLAC the operator has, so a fresh corpus on another machine encodes to different byte counts —
 * and enqueuing the wrong `size` is exactly the condition slskd answers with a size-mismatch abort.
 * The failure would surface two minutes later as an unrelated-looking scenario timeout.
 */
function sizeOf(remoteFilename: string): number {
  const relative = remoteFilename.replaceAll('\\', '/').replace(/^corpus\//, '');
  return statSync(`${LAB_DIR}corpus/${relative}`).size;
}
/** A name the peer demonstrably does not share — the deterministic rejection. */
const UNSHARED_FILE = `${SHARE}\\99 - Not Shared.flac`;
const EVENTS_LIMIT = 100;
const EVENTS_KEPT = 3;
/** A user the lab has never transferred with, so its downloads collection is genuinely absent. */
const STRANGER = 'nobody';

const LAB_SOURCE =
  'slskd recording lab (soulfind ghcr.io/soulfind-dev/soulfind@sha256:3de2e82f + ' +
  'slskd/slskd@sha256:f5150c39, docker compose)';

const capturedAt = new Date().toISOString().slice(0, 10);
// Seeded so every scenario resolves the lab identities to the same aliases whether it runs alone
// or in a full sweep — scenario independence is the point of the lab.
const { alias, sanitize, aliases } = createAnonymizer([PEER, STRANGER]);
// slskd's API key auth is disabled in the lab (SLSKD_NO_AUTH), but the header is sent anyway so the
// recorded requests carry the same shape a live capture would.
const call = createCaller(SUT_URL, process.env.SLSKD_LAB_API_KEY ?? 'lab');

/**
 * A call whose success is a *precondition* for the scenario, not the thing being recorded. Without
 * this, a refused enqueue is discarded and the run blocks until a 120-second `waitFor` fails naming
 * a symptom ("the hog never occupied the slot") rather than the cause — and, worse, `queued` would
 * commit a 500 under a note claiming an accepted enqueue.
 */
async function expectOk(
  method: 'GET' | 'POST' | 'DELETE',
  path: string,
  body?: unknown,
): Promise<Capture> {
  const capture = await call(method, path, body);
  if (capture.status < 200 || capture.status >= 300) {
    throw new Error(`${method} ${path} → ${capture.status}: ${JSON.stringify(capture.body)}`);
  }
  return capture;
}

function envelope(
  request: ContractFixture['request'],
  raw: Capture,
  note: string,
): ContractFixture {
  return {
    provenance: { source: LAB_SOURCE, capturedAt, serviceVersion: PINNED_SLSKD_VERSION, note },
    request: { ...request, path: sanitize(request.path) as string },
    response: { status: raw.status, body: sanitize(raw.body) },
  };
}

const downloadsPath = (user: string): string =>
  `/api/v0/transfers/downloads/${encodeURIComponent(user)}`;

interface LabTransfer {
  readonly id?: string;
  readonly filename?: string;
  readonly state?: string;
}

async function pollTransfers(user: string = PEER): Promise<{ raw: Capture; files: LabTransfer[] }> {
  const raw = await call('GET', downloadsPath(user));
  // A 404 here means "this user has no transfers" — real state. Anything else non-2xx is a fault,
  // and folding it into an empty list is the truncated-read-as-empty mistake this project has
  // already shipped a production fix for: the reset would report the lab clean when it is not.
  if (raw.status !== 200 && raw.status !== 404) {
    throw new Error(`GET ${downloadsPath(user)} → ${raw.status}: ${JSON.stringify(raw.body)}`);
  }
  const dirs = (raw.body as { directories?: { files?: LabTransfer[] }[] } | undefined)?.directories;
  return { raw, files: (dirs ?? []).flatMap((d) => d.files ?? []) };
}

/** Wait until a transfer matching `filename` reaches a state satisfying `predicate`. */
async function waitFor(
  filename: string,
  predicate: (state: string) => boolean,
  label: string,
  timeoutMs = 120_000,
): Promise<LabTransfer> {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    const { files } = await pollTransfers();
    const hit = files.find((f) => f.filename === filename);
    if (hit !== undefined && predicate(hit.state ?? '')) return hit;
    if (Date.now() > deadline) {
      throw new Error(`timed out waiting for ${label} on ${filename} (last: ${hit?.state})`);
    }
    await sleep(2000);
  }
}

/**
 * Return the lab to a no-transfers state: cancel whatever is in flight, then remove every record.
 * slskd refuses to remove a transfer that has not reached `Completed`, which is the same two-phase
 * dance the production teardown performs — so the reset exercises it too.
 */
async function resetTransfers(): Promise<void> {
  for (let round = 0; round < 10; round += 1) {
    const { files } = await pollTransfers();
    if (files.length === 0) return;
    for (const file of files) {
      if (file.id === undefined) continue;
      const terminal = (file.state ?? '').toLowerCase().includes('completed');
      await call('DELETE', `${downloadsPath(PEER)}/${file.id}?remove=${terminal}`);
    }
    await sleep(2000);
  }
  throw new Error('could not clear the lab transfer list');
}

async function compose(...args: string[]): Promise<void> {
  await execFileAsync('docker', ['compose', '-f', `${LAB_DIR}compose.yaml`, ...args]);
}

/** Wait until the sut's own API is answering again after a restart. */
async function waitForSut(): Promise<void> {
  const deadline = Date.now() + 120_000;
  for (;;) {
    const alive = await fetch(`${SUT_URL}/api/v0/server`).then(
      (r) => r.ok,
      () => false,
    );
    if (alive) {
      // Answering HTTP precedes being logged in; the presence wait that follows covers the rest.
      await sleep(2000);
      return;
    }
    if (Date.now() > deadline) throw new Error('lab sut did not come back');
    await sleep(2000);
  }
}

/**
 * Wait until the *sut* sees the peer in the given presence. Asking the sut rather than the peer is
 * deliberate: what decides which failure slskd reports is the sut's view of the peer, and that view
 * lags a container stop. Recording "peer offline" while the sut still believed the peer was online
 * produced a connection failure instead — a real failure, but not the one the scenario is named
 * for. This is orchestration establishing a precondition, not retrying until a nice answer appears:
 * the enqueue is issued exactly once, after the state is known.
 *
 * `GET /api/v0/users/{username}/status` is recorder-only surface — no adapter consumes it, so it is
 * deliberately absent from the consumed-operations manifest.
 */
async function waitForPeerPresence(presence: 'Online' | 'Offline'): Promise<void> {
  const deadline = Date.now() + 120_000;
  for (;;) {
    const status = await call('GET', `/api/v0/users/${PEER}/status`);
    if ((status.body as { presence?: string } | undefined)?.presence === presence) {
      // Presence is not yet searchability: give soulfind a beat to see the share announcement.
      if (presence === 'Online') await sleep(3000);
      return;
    }
    if (Date.now() > deadline) throw new Error(`lab peer never became ${presence}`);
    await sleep(2000);
  }
}

// ---------------------------------------------------------------------------------------------
// Scenarios
// ---------------------------------------------------------------------------------------------

/**
 * The whole happy path in one run: create a search, poll it to completion, read its per-peer
 * responses, enqueue a real file, poll the transfer to `Completed, Succeeded`, then read the events
 * log and the effective options.
 *
 * This is one scenario rather than seven captures because the fixtures are *coupled*: the staged-
 * path resolver matches a `DownloadFileComplete` event to a polled transfer by `transfer.id`, so an
 * events capture only means anything alongside the poll from the same session. Recording them
 * together is what makes the set re-recordable at all — before the lab, this coupling was a warning
 * comment telling the next maintainer the set could not be regenerated.
 */
async function fullFlow(): Promise<void> {
  const write = createWriter('full-flow');
  await resetTransfers();

  const create = await call('POST', '/api/v0/searches', { searchText: 'Lab Artist Lab Album' });
  const searchId = (create.body as { id?: string }).id;
  if (searchId === undefined) throw new Error('search create returned no id');
  write(
    'search-create.json',
    envelope({ method: 'POST', path: '/api/v0/searches' }, create, 'search creation'),
  );

  let state: Capture | undefined;
  for (let i = 0; i < 30; i += 1) {
    await sleep(1000);
    state = await call('GET', `/api/v0/searches/${searchId}`);
    if ((state.body as { isComplete?: boolean }).isComplete === true) break;
  }
  if (state === undefined) throw new Error('search never reported state');
  write(
    'search-state.json',
    envelope(
      { method: 'GET', path: `/api/v0/searches/${searchId}` },
      state,
      'a settled search — isComplete/state/responseCount are the harvest-integrity gate',
    ),
  );

  const responses = await call('GET', `/api/v0/searches/${searchId}/responses`);
  write(
    'search-responses.json',
    envelope(
      { method: 'GET', path: `/api/v0/searches/${searchId}/responses` },
      responses,
      'per-peer search responses from the lab peer',
    ),
  );

  // The search adapter releases its server-side search when it is done with it. Recording the call
  // here is what lets the replay test assert the DELETE actually goes out.
  const searchDelete = await call('DELETE', `/api/v0/searches/${searchId}`);
  write(
    'search-delete.json',
    envelope(
      { method: 'DELETE', path: `/api/v0/searches/${searchId}` },
      searchDelete,
      'releasing a completed search — a 204 with no body',
    ),
  );

  const enqueue = await expectOk('POST', downloadsPath(PEER), [
    { filename: SMALL_FILE, size: sizeOf(SMALL_FILE) },
  ]);
  write(
    'transfers-enqueue.json',
    envelope(
      { method: 'POST', path: downloadsPath(alias(PEER)) },
      enqueue,
      'accepted enqueue — a 201 whose body the adapter does not consume',
    ),
  );

  const settled = await waitFor(
    SMALL_FILE,
    (s) => s.includes('Completed'),
    'the transfer to settle',
  );
  const { raw: poll } = await pollTransfers();
  write(
    'transfers-poll.json',
    envelope(
      { method: 'GET', path: downloadsPath(alias(PEER)) },
      poll,
      'a succeeded transfer in its nested directories[].files[] shape',
    ),
  );

  const events = await call('GET', `/api/v0/events?offset=0&limit=${EVENTS_LIMIT}`);
  write(
    'events.json',
    envelope(
      {
        method: 'GET',
        path: '/api/v0/events',
        query: { offset: '0', limit: String(EVENTS_LIMIT) },
      },
      { status: events.status, body: projectEvents(events.body, EVENTS_KEPT, settled.id) },
      "the completion of THIS run's transfer — data is a JSON-encoded string, matched by transfer.id",
    ),
  );

  const options = await call('GET', '/api/v0/options');
  write(
    'options.json',
    envelope(
      { method: 'GET', path: '/api/v0/options' },
      { status: options.status, body: projectOptions(options.body) },
      'only directories.downloads is consumed (the root a staged path is re-rooted from)',
    ),
  );

  await resetTransfers();
}

/**
 * A genuinely queued transfer, with its queue position. The peer has exactly one upload slot (the
 * configurable floor), so occupying it with the slot hog forces anything enqueued behind into a
 * real remote queue.
 *
 * The position is the point. `placeInQueue` is pull, not push: it stays null in every poll until
 * something asks the peer via the position endpoint, which is why this scenario records the
 * position call and the poll that follows it as a pair. Before the lab there was no queued capture
 * at all — the tier's only recorded poll was a succeeded transfer, under a docstring claiming it
 * was "genuinely `Queued, Remotely`".
 */
async function queued(): Promise<void> {
  const write = createWriter('queued');
  await resetTransfers();

  await expectOk('POST', downloadsPath(PEER), [{ filename: HOG_FILE, size: sizeOf(HOG_FILE) }]);
  await waitFor(HOG_FILE, (s) => s.includes('InProgress'), 'the hog to occupy the upload slot');

  const enqueue = await expectOk('POST', downloadsPath(PEER), [
    { filename: QUEUED_FILE, size: sizeOf(QUEUED_FILE) },
  ]);
  // The accepted enqueue is recorded alongside the poll so a replay test can drive the *whole*
  // adapter — enqueue then watch — rather than only parsing the poll body.
  write(
    'transfers-enqueue.json',
    envelope(
      { method: 'POST', path: downloadsPath(alias(PEER)) },
      enqueue,
      'accepted enqueue for the file that goes on to queue behind the slot hog',
    ),
  );
  const behind = await waitFor(QUEUED_FILE, (s) => s.includes('Queued'), 'the queue to form');
  if (behind.id === undefined) throw new Error('queued transfer has no id');

  const position = await call('GET', `${downloadsPath(PEER)}/${behind.id}/position`);
  write(
    'transfers-position.json',
    envelope(
      { method: 'GET', path: `${downloadsPath(alias(PEER))}/${behind.id}/position` },
      position,
      'the position endpoint answers a bare integer and writes it onto the transfer row',
    ),
  );

  await sleep(2000);
  const { raw: poll } = await pollTransfers();
  write(
    'transfers-poll.json',
    envelope(
      { method: 'GET', path: downloadsPath(alias(PEER)) },
      poll,
      'Queued, Remotely with placeInQueue populated — only because the position call preceded it',
    ),
  );

  await resetTransfers();
}

/**
 * A cancelled transfer. `?remove=false` cancels but keeps the record, so the poll that follows
 * witnesses the terminal `Completed, Cancelled` state and its exception text — the two-phase
 * teardown the production adapter performs, recorded from the outside.
 */
async function cancelled(): Promise<void> {
  const write = createWriter('cancelled');
  await resetTransfers();

  await expectOk('POST', downloadsPath(PEER), [{ filename: HOG_FILE, size: sizeOf(HOG_FILE) }]);
  const hog = await waitFor(HOG_FILE, (s) => s.includes('InProgress'), 'the transfer to start');
  if (hog.id === undefined) throw new Error('in-flight transfer has no id');

  const cancel = await call('DELETE', `${downloadsPath(PEER)}/${hog.id}?remove=false`);
  write(
    'transfers-cancel.json',
    envelope(
      {
        method: 'DELETE',
        path: `${downloadsPath(alias(PEER))}/${hog.id}`,
        query: { remove: 'false' },
      },
      cancel,
      'phase one of teardown: cancel without removing, so the record survives to be witnessed',
    ),
  );

  await waitFor(HOG_FILE, (s) => s.includes('Completed'), 'the cancellation to become terminal');
  const { raw: poll } = await pollTransfers();
  write(
    'transfers-poll.json',
    envelope(
      { method: 'GET', path: downloadsPath(alias(PEER)) },
      poll,
      'Completed, Cancelled — the state and exception a cancelled transfer actually carries',
    ),
  );

  await resetTransfers();
}

/**
 * A rejected enqueue. Asking the peer for a file it does not share makes it answer
 * `File not shared.`, which reaches us two ways at once: as the enqueue's 500 body, and as the
 * `exception` on a transfer row that ends `Completed, Errored`. Both are consumed by the
 * classifier, and recording them together is what proved the two paths were classifying the same
 * rejection differently.
 */
async function rejection(): Promise<void> {
  const write = createWriter('rejection');
  await resetTransfers();

  const enqueue = await call('POST', downloadsPath(PEER), [
    { filename: UNSHARED_FILE, size: sizeOf(SMALL_FILE) },
  ]);
  write(
    'transfers-enqueue.json',
    envelope(
      { method: 'POST', path: downloadsPath(alias(PEER)) },
      enqueue,
      'the rejection body is a bare exception message, not JSON — captured verbatim',
    ),
  );

  await waitFor(UNSHARED_FILE, (s) => s.includes('Completed'), 'the rejected row to settle');
  const { raw: poll } = await pollTransfers();
  write(
    'transfers-poll.json',
    envelope(
      { method: 'GET', path: downloadsPath(alias(PEER)) },
      poll,
      'the same rejection as slskd persists it: Completed, Errored with the peer’s reason',
    ),
  );

  await resetTransfers();
}

/**
 * A peer that dies mid-transfer. slskd collapses every non-cancellation failure into
 * `Completed, Errored`, so the only thing distinguishing a dead peer from any other error is the
 * `exception` text — which is exactly why it has to be witnessed rather than guessed.
 */
async function errored(): Promise<void> {
  const write = createWriter('errored');
  await resetTransfers();

  await expectOk('POST', downloadsPath(PEER), [{ filename: HOG_FILE, size: sizeOf(HOG_FILE) }]);
  await waitFor(HOG_FILE, (s) => s.includes('InProgress'), 'the transfer to start');

  await compose('kill', 'peer');
  try {
    await waitFor(HOG_FILE, (s) => s.includes('Completed'), 'the transfer to fail');
    const { raw: poll } = await pollTransfers();
    write(
      'transfers-poll.json',
      envelope(
        { method: 'GET', path: downloadsPath(alias(PEER)) },
        poll,
        'Completed, Errored after the peer vanished mid-flight',
      ),
    );
  } finally {
    // Restore the peer even if the capture threw: a dead peer left behind fails the NEXT scenario,
    // for reasons that have nothing to do with it.
    await compose('start', 'peer').catch((error: unknown) =>
      console.error('failed to restart the lab peer', error),
    );
  }
  await waitForPeerPresence('Online');
  await resetTransfers();
}

/**
 * An enqueue to a peer that is not on the network. slskd never creates a transfer row for this —
 * it resolves the peer first — so the failure exists *only* as the 500 body, which is why the
 * classifier's enqueue-rejection path has to read these strings.
 *
 * There are two of them, and which one you get depends on what slskd already knows. With the peer's
 * address still cached from recent contact it attempts the connection and fails; with a cold cache
 * it asks the server and is told the user is offline. Both are the same fact — the source is not
 * reachable — and the classifier must land both on the same reason, so the scenario witnesses each
 * deliberately rather than recording whichever the sweep order happened to produce.
 */
async function offline(): Promise<void> {
  await resetTransfers();

  // Warm slskd's view of the peer with a real transfer, so the first capture is the cached-address
  // path rather than an accident of what ran before.
  await expectOk('POST', downloadsPath(PEER), [{ filename: SMALL_FILE, size: sizeOf(SMALL_FILE) }]);
  await waitFor(SMALL_FILE, (s) => s.includes('Completed'), 'a transfer to warm the peer address');
  await resetTransfers();

  await compose('stop', 'peer');
  try {
    await recordOfflineSpellings();
  } finally {
    await compose('start', 'peer').catch((error: unknown) =>
      console.error('failed to restart the lab peer', error),
    );
  }
  await waitForPeerPresence('Online');
  await resetTransfers();
}

/** The two captures the `offline` scenario exists for, with the peer already stopped. */
async function recordOfflineSpellings(): Promise<void> {
  const write = createWriter('offline');
  await waitForPeerPresence('Offline');

  const unreachable = await call('POST', downloadsPath(PEER), [
    { filename: SMALL_FILE, size: sizeOf(SMALL_FILE) },
  ]);
  // Its own scenario directory, not a second file here: both captures are the same
  // `POST /api/v0/transfers/downloads/{user}` route, and the replay server keys routes by
  // method+path — two recordings of one route in one scenario means one silently wins.
  createWriter('unreachable')(
    'transfers-enqueue.json',
    envelope(
      { method: 'POST', path: downloadsPath(alias(PEER)) },
      unreachable,
      'the address was cached, so slskd tried the connection and reports the failure to connect',
    ),
  );

  // Restarting the sut drops what it had cached about the peer, so the next enqueue takes the
  // ask-the-server path and gets the other spelling.
  await compose('restart', 'sut');
  await waitForSut();
  await waitForPeerPresence('Offline');

  const enqueue = await call('POST', downloadsPath(PEER), [
    { filename: SMALL_FILE, size: sizeOf(SMALL_FILE) },
  ]);
  write(
    'transfers-enqueue.json',
    envelope(
      { method: 'POST', path: downloadsPath(alias(PEER)) },
      enqueue,
      'nothing cached, so slskd asks the server and reports the peer as offline',
    ),
  );
}

/**
 * A peer that is *present but unresponsive* — the third distinct way an enqueue fails, and the one
 * hardest to get by luck. Pausing the container freezes its processes while its server connection
 * stays open, so the sut still believes the peer is online and waits on a reply that never comes.
 * slskd surfaces that as a wait-timeout message, which is a different string from both the offline
 * and rejection bodies and classifies differently — a stalled source, not a missing one.
 */
async function stalled(): Promise<void> {
  const write = createWriter('stalled');
  await resetTransfers();

  await compose('pause', 'peer');
  try {
    const enqueue = await call('POST', downloadsPath(PEER), [
      { filename: SMALL_FILE, size: sizeOf(SMALL_FILE) },
    ]);
    write(
      'transfers-enqueue.json',
      envelope(
        { method: 'POST', path: downloadsPath(alias(PEER)) },
        enqueue,
        'the peer never answered — slskd gives up with a wait timeout, not an offline report',
      ),
    );
  } finally {
    // Unpause even if the capture threw: a paused peer would silently wreck every later scenario.
    // Its own failure is logged rather than thrown, so it cannot replace the original error.
    await compose('unpause', 'peer').catch((error: unknown) =>
      console.error('failed to unpause the lab peer', error),
    );
  }
  await waitForPeerPresence('Online');
  await resetTransfers();
}

/**
 * The absence signal. slskd 404s the downloads collection of a user it holds no transfers for, and
 * the adapter reads that as *state* ("nothing there, converge"), never as a fault to retry — the
 * distinction that wedged the reactor on a cancelled acquisition's abort in production.
 */
async function absent(): Promise<void> {
  const write = createWriter('absent');

  const poll = await call('GET', downloadsPath(STRANGER));
  write(
    'transfers-poll.json',
    envelope(
      { method: 'GET', path: downloadsPath(alias(STRANGER)) },
      poll,
      'a 404 that means "no transfers", not "error" — read as state by the adapter',
    ),
  );
}

const SCENARIOS: Record<string, () => Promise<void>> = {
  'full-flow': fullFlow,
  queued,
  cancelled,
  rejection,
  errored,
  offline,
  stalled,
  absent,
};

async function main(): Promise<void> {
  await assertPinnedVersion(call);
  const requested = process.argv.slice(2);
  const names = requested.length > 0 ? requested : Object.keys(SCENARIOS);
  for (const name of names) {
    const scenario = SCENARIOS[name];
    if (scenario === undefined) {
      throw new Error(`unknown scenario "${name}" (have: ${Object.keys(SCENARIOS).join(', ')})`);
    }
    console.log(`\n── scenario: ${name} ──`);
    await scenario();
  }
  console.log(`\nusername aliases: ${JSON.stringify(aliases())}`);
}

main().catch((error: unknown) => {
  console.error(
    '\nrecording failed — the lab may be left dirty and the fixture set half-rewritten',
  );
  console.error(error);
  process.exitCode = 1;
});
