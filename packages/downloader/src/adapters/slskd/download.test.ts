import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { FakeResourceLedger, silentLogger } from '../../application/__fixtures__/fakes.js';
import type { Candidate } from '../../domain/candidate/candidate.js';
import type { DownloadPolicy } from '../../domain/policy/policies.js';
import type { DownloadProgress } from '../../application/ports/outbound-ports.js';
import type { HttpClient, HttpResponse } from '../support/http.js';
import { SlskdClient } from './client.js';
import { SlskdDownload } from './download.js';
import type { Timer } from './timer.js';

const STAGING = '/staging';
const DOWNLOADS_ROOT = '/downloads';
const ACQ = 'acq-1';
const candidate: Candidate = {
  identity: { username: 'u1', path: '@@a\\Album', sizeBytes: 200 },
  files: [
    { name: '01.flac', sizeBytes: 100 },
    { name: '02.flac', sizeBytes: 100 },
  ],
  source: { speedBytesPerSec: 0, freeSlots: 1, queueLength: 0 },
};

const policy = (stallTimeoutMs: number, maxQueueWaitMs: number): DownloadPolicy => ({
  stallTimeoutMs,
  maxQueueWaitMs,
});

function transfer(name: string, extra: Record<string, unknown> = {}): Record<string, unknown> {
  return { id: name, filename: `@@a\\Album\\${name}`, ...extra };
}

function poll(files: readonly unknown[]): HttpResponse {
  // Mirror slskd's real per-user download payload: a single object whose transfers hang off
  // `directories`, each group carrying a `files` array (verified against slskd 0.22.5).
  return {
    status: 200,
    body: JSON.stringify({ username: 'u1', directories: [{ directory: 'd', files }] }),
  };
}

interface Completion {
  readonly id: string;
  readonly local: string;
}

/** A page of the slskd events log: one `DownloadFileComplete` record per completion. */
function eventsPage(completions: readonly Completion[]): HttpResponse {
  return {
    status: 200,
    body: JSON.stringify(
      completions.map((completion) => ({
        type: 'DownloadFileComplete',
        data: JSON.stringify({
          localFilename: completion.local,
          transfer: { id: completion.id },
        }),
      })),
    ),
  };
}

/** slskd's downloads-root under its own container path — what `localFilename` is reported against. */
function localOf(name: string, onDisk = name): string {
  return `${DOWNLOADS_ROOT}/Album/${onDisk}`;
}

function optionsResponse(downloads = DOWNLOADS_ROOT): HttpResponse {
  return { status: 200, body: JSON.stringify({ directories: { downloads } }) };
}

/** Where the adapter should report a completed file: slskd's path re-rooted onto STAGING. */
function stagedPath(onDisk: string): string {
  return join(STAGING, 'Album', onDisk);
}

function fakeTimer(): Timer {
  let current = 0;
  return {
    now: () => current,
    sleep: (ms) => {
      current += ms;
      return Promise.resolve();
    },
  };
}

const bothSucceeded = poll([
  transfer('01.flac', { state: 'Completed, Succeeded', size: 100, bytesTransferred: 100 }),
  transfer('02.flac', { state: 'Completed, Succeeded', size: 100, bytesTransferred: 100 }),
]);

const bothCompleted = eventsPage([
  { id: '01.flac', local: localOf('01.flac') },
  { id: '02.flac', local: localOf('02.flac') },
]);

interface Opts {
  enqueue?: HttpResponse;
  enqueueThrows?: boolean; // transport-level failure: slskd itself unreachable
  polls: HttpResponse[];
  events?: HttpResponse[];
  options?: HttpResponse;
  deleteStatus?: number; // status returned for record-removal DELETEs (default 204)
}

interface Harness {
  adapter: SlskdDownload;
  deletes: string[];
  ledger: FakeResourceLedger;
  counts: { options: number; events: number; posts: number };
}

function drain(queue: HttpResponse[], fallback: HttpResponse): HttpResponse {
  return (queue.length > 1 ? queue.shift() : queue[0]) ?? fallback;
}

function downloader(opts: Opts): Harness {
  const deletes: string[] = [];
  const ledger = new FakeResourceLedger();
  const counts = { options: 0, events: 0, posts: 0 };
  const polls = [...opts.polls];
  // Default to a page that resolves the candidate's two transfers, so a succeeded outcome reports
  // its staged files without every test having to spell out the events stub.
  const events = [...(opts.events ?? [bothCompleted])];
  const http: HttpClient = {
    send: ({ method, url }) => {
      if (method === 'POST') {
        counts.posts += 1;
        if (opts.enqueueThrows) return Promise.reject(new Error('socket hang up'));
        return Promise.resolve(opts.enqueue ?? { status: 200, body: '' });
      }
      if (method === 'DELETE') {
        deletes.push(url);
        return Promise.resolve({ status: opts.deleteStatus ?? 204, body: '' });
      }
      if (url.includes('/api/v0/options')) {
        counts.options += 1;
        return Promise.resolve(opts.options ?? optionsResponse());
      }
      if (url.includes('/api/v0/events')) {
        counts.events += 1;
        return Promise.resolve(drain(events, eventsPage([])));
      }
      return Promise.resolve(drain(polls, { status: 200, body: '{"directories":[]}' }));
    },
  };
  const adapter = new SlskdDownload(
    silentLogger(),
    ledger,
    { stagingRoot: STAGING, pollIntervalMs: 100 },
    new SlskdClient(http),
    fakeTimer(),
  );
  return { adapter, deletes, ledger, counts };
}

describe('SlskdDownload', () => {
  it('reports a completed multi-file candidate at the slskd-reported on-disk location', async () => {
    const progress: DownloadProgress[] = [];
    const { adapter } = downloader({
      polls: [
        poll([
          transfer('01.flac', { state: 'Completed, Succeeded', size: 100, bytesTransferred: 100 }),
          transfer('02.flac', { state: 'Completed, Succeeded', size: 100, bytesTransferred: 100 }),
          { state: 'InProgress' }, // an unrelated transfer with no filename is ignored
        ]),
      ],
      events: [bothCompleted],
    });

    const result = await adapter.download(ACQ, candidate, policy(1000, 1000), (p) =>
      progress.push(p),
    );

    expect(result._unsafeUnwrap()).toEqual({
      kind: 'completed',
      files: [
        { name: '01.flac', path: stagedPath('01.flac') },
        { name: '02.flac', path: stagedPath('02.flac') },
      ],
    });
    expect(progress.at(-1)?.percent).toBe(100);
  });

  it('keeps the clean candidate name while pointing at slskd’s renamed on-disk file', async () => {
    // slskd sanitized/de-duplicated 01.flac to 01_123456.flac; the event carries the real name.
    const { adapter } = downloader({
      polls: [bothSucceeded],
      events: [
        eventsPage([
          { id: '01.flac', local: localOf('01.flac', '01_123456.flac') },
          { id: '02.flac', local: localOf('02.flac') },
        ]),
      ],
    });

    const result = await adapter.download(ACQ, candidate, policy(1000, 1000), () => undefined);

    expect(result._unsafeUnwrap()).toEqual({
      kind: 'completed',
      files: [
        { name: '01.flac', path: stagedPath('01_123456.flac') },
        { name: '02.flac', path: stagedPath('02.flac') },
      ],
    });
  });

  it('pages older events until every completed transfer id resolves', async () => {
    const { adapter, counts } = downloader({
      polls: [bothSucceeded],
      events: [
        eventsPage([{ id: '01.flac', local: localOf('01.flac') }]), // offset 0 — only one of ours
        eventsPage([{ id: '02.flac', local: localOf('02.flac') }]), // offset 100 — the other
      ],
    });

    const result = await adapter.download(ACQ, candidate, policy(1000, 1000), () => undefined);

    expect(result._unsafeUnwrap().kind).toBe('completed');
    expect(counts.events).toBe(2);
  });

  it('re-polls the events log when a completion event lags the transfer-state flip', async () => {
    const { adapter, counts } = downloader({
      polls: [bothSucceeded],
      events: [eventsPage([]), bothCompleted], // empty on first poll, complete on the next
    });

    const result = await adapter.download(ACQ, candidate, policy(1000, 1000), () => undefined);

    expect(result._unsafeUnwrap().kind).toBe('completed');
    expect(counts.events).toBe(2);
  });

  it('gives up as an InfraError when the events log never reports the completion', async () => {
    const { adapter } = downloader({ polls: [bothSucceeded], events: [eventsPage([])] });

    const result = await adapter.download(ACQ, candidate, policy(1000, 1000), () => undefined);

    expect(result._unsafeUnwrapErr()).toMatchObject({
      kind: 'InfraError',
      operation: 'slskd.download',
    });
  });

  it('reads the downloads root once and caches it across downloads', async () => {
    const { adapter, counts } = downloader({ polls: [bothSucceeded], events: [bothCompleted] });

    await adapter.download(ACQ, candidate, policy(1000, 1000), () => undefined);
    await adapter.download(ACQ, candidate, policy(1000, 1000), () => undefined);

    expect(counts.options).toBe(1);
  });

  it('surfaces a contract-violating options body as an InfraError', async () => {
    const { adapter } = downloader({
      polls: [bothSucceeded],
      events: [bothCompleted],
      options: { status: 200, body: JSON.stringify({ directories: {} }) },
    });

    const result = await adapter.download(ACQ, candidate, policy(1000, 1000), () => undefined);

    expect(result._unsafeUnwrapErr()).toMatchObject({
      kind: 'InfraError',
      operation: 'slskd.download',
    });
  });

  it('fails the whole candidate when a file does not transfer', async () => {
    const { adapter } = downloader({
      polls: [
        poll([
          transfer('01.flac', { state: 'Completed, Succeeded', size: 100, bytesTransferred: 100 }),
          transfer('02.flac', { state: 'Completed, Errored', size: 100, bytesTransferred: 40 }),
        ]),
      ],
    });

    const result = await adapter.download(ACQ, candidate, policy(1000, 1000), () => undefined);

    // 01 completed before the doom, so its staged path is surfaced for cleanup (default events stub).
    expect(result._unsafeUnwrap()).toEqual({
      kind: 'failed',
      reason: 'TransferError',
      files: [{ name: '01.flac', path: stagedPath('01.flac') }],
    });
  });

  it('normalizes an offline peer to a peer-unavailable outcome', async () => {
    const { adapter } = downloader({
      polls: [
        poll([
          transfer('01.flac', { state: 'Completed, Errored', exception: 'User is offline' }),
          transfer('02.flac', { state: 'Completed, Errored', exception: 'User is offline' }),
        ]),
      ],
    });

    const result = await adapter.download(ACQ, candidate, policy(1000, 1000), () => undefined);

    // Neither file completed, so there is nothing staged to clean up.
    expect(result._unsafeUnwrap()).toEqual({
      kind: 'failed',
      reason: 'PeerUnavailable',
      files: [],
    });
  });

  it('abandons a stalled transfer, cancelling then confirming its records removed', async () => {
    const inFlight = poll([
      transfer('01.flac', { state: 'InProgress', size: 100, bytesTransferred: 50 }),
      transfer('02.flac', { state: 'InProgress', size: 100, bytesTransferred: 0 }),
    ]);
    const cancelled = poll([
      transfer('01.flac', { state: 'Completed, Cancelled' }),
      transfer('02.flac', { state: 'Completed, Cancelled' }),
      { id: 'foreign', filename: '@@a\\Other\\9.flac', state: 'InProgress' }, // another candidate
      { id: 'nameless', state: 'InProgress' }, // a transfer with no filename
    ]);
    const { adapter, deletes, ledger } = downloader({
      // Two identical in-flight polls advance the clock to the stall; the teardown then re-polls a
      // cancelled-terminal set, and a final empty poll confirms the records are gone.
      polls: [inFlight, inFlight, cancelled, poll([])],
    });

    const result = await adapter.download(ACQ, candidate, policy(50, 100000), () => undefined);

    expect(result._unsafeUnwrap()).toEqual({ kind: 'failed', reason: 'Stalled', files: [] });
    // Each transfer is cancelled (remove=false), then removed once terminal (remove=true).
    expect(deletes).toEqual([
      'http://localhost:5030/api/v0/transfers/downloads/u1/01.flac?remove=false',
      'http://localhost:5030/api/v0/transfers/downloads/u1/02.flac?remove=false',
      'http://localhost:5030/api/v0/transfers/downloads/u1/01.flac?remove=true',
      'http://localhost:5030/api/v0/transfers/downloads/u1/02.flac?remove=true',
    ]);
    expect(ledger.removed).toHaveLength(2); // both confirmed gone
  });

  describe('reconcile-before-enqueue (reactor-durability D3)', () => {
    /**
     * The prior attempt's write-ahead rows, as a crashed poller would have left them. The
     * resourceKey follows TransferLedger.keyFor's `${username}|${remoteFilename}` contract —
     * drifting from it makes the rows invisible to reconciliation (posts would become 1).
     */
    function seedLedgeredTransfers(ledger: FakeResourceLedger): void {
      for (const name of ['01.flac', '02.flac']) {
        ledger.created.push({
          source: 'slskd',
          kind: 'transfer',
          resourceKey: `u1|@@a\\Album\\${name}`,
          acquisitionId: ACQ,
        });
      }
    }

    const inFlight = poll([
      transfer('01.flac', { state: 'InProgress', size: 100, bytesTransferred: 50 }),
      transfer('02.flac', { state: 'InProgress', size: 100, bytesTransferred: 50 }),
    ]);

    it('re-attaches to live ledgered transfers instead of downloading a second time', async () => {
      const harness = downloader({ polls: [inFlight, bothSucceeded], events: [bothCompleted] });
      seedLedgeredTransfers(harness.ledger);

      const result = await harness.adapter.download(ACQ, candidate, policy(1000, 1000), () => {});

      expect(result._unsafeUnwrap().kind).toBe('completed');
      expect(harness.counts.posts).toBe(0); // never enqueued again — polling resumed
    });

    it('re-enqueues when the source retains only a subset of the ledgered transfers', async () => {
      // Resuming over a partial survival would settle the poll over the present file alone and
      // report an under-delivered candidate as completed — a partial must re-enqueue instead.
      const onlyFirst = poll([
        transfer('01.flac', { state: 'InProgress', size: 100, bytesTransferred: 50 }),
      ]);
      const harness = downloader({ polls: [onlyFirst, bothSucceeded], events: [bothCompleted] });
      seedLedgeredTransfers(harness.ledger);

      const result = await harness.adapter.download(ACQ, candidate, policy(1000, 1000), () => {});

      expect(result._unsafeUnwrap().kind).toBe('completed');
      expect(harness.counts.posts).toBe(1);
    });

    it('re-enqueues when the ledgered transfers were lost at the source', async () => {
      const harness = downloader({ polls: [poll([]), bothSucceeded], events: [bothCompleted] });
      seedLedgeredTransfers(harness.ledger);

      const result = await harness.adapter.download(ACQ, candidate, policy(1000, 1000), () => {});

      expect(result._unsafeUnwrap().kind).toBe('completed');
      expect(harness.counts.posts).toBe(1);
    });

    it('applies the queue-wait budget from re-attach — a resumed transfer can still time out', async () => {
      const queued = poll([
        transfer('01.flac', { state: 'Queued, Remotely', size: 100, placeInQueue: 4 }),
        transfer('02.flac', { state: 'Queued, Remotely', size: 100 }),
      ]);
      const harness = downloader({ polls: [queued, queued, queued, poll([])] });
      seedLedgeredTransfers(harness.ledger);

      const result = await harness.adapter.download(ACQ, candidate, policy(100000, 50), () => {});

      expect(result._unsafeUnwrap()).toEqual({ kind: 'failed', reason: 'QueueTimeout', files: [] });
      expect(harness.counts.posts).toBe(0);
    });

    it('a fresh download consults no listing before its enqueue (no prior ledger rows)', async () => {
      const harness = downloader({ polls: [bothSucceeded], events: [bothCompleted] });

      const result = await harness.adapter.download(ACQ, candidate, policy(1000, 1000), () => {});

      expect(result._unsafeUnwrap().kind).toBe('completed');
      expect(harness.counts.posts).toBe(1);
    });

    it('degrades to a plain enqueue when the ledger cannot be read', async () => {
      const harness = downloader({ polls: [bothSucceeded], events: [bothCompleted] });
      seedLedgeredTransfers(harness.ledger);
      harness.ledger.fail = true;

      const result = await harness.adapter.download(ACQ, candidate, policy(1000, 1000), () => {});

      expect(result._unsafeUnwrap().kind).toBe('completed');
      expect(harness.counts.posts).toBe(1);
    });
  });

  it('abandons a hopelessly-queued transfer once the queue wait elapses', async () => {
    const queued = poll([
      transfer('01.flac', { state: 'Queued, Remotely', size: 100, placeInQueue: 4 }),
      { filename: '@@a\\Album\\02.flac', state: 'Queued, Remotely', size: 100 }, // no id
    ]);
    const { adapter, deletes, ledger } = downloader({
      // Two identical queued polls advance the clock past the queue wait; the teardown then finds
      // the cancelled transfers already gone on its re-poll.
      polls: [queued, queued, poll([])],
    });

    const result = await adapter.download(ACQ, candidate, policy(100000, 50), () => undefined);

    expect(result._unsafeUnwrap()).toEqual({ kind: 'failed', reason: 'QueueTimeout', files: [] });
    // Both queued (non-terminal) transfers are cancelled; the re-poll then finds them gone.
    expect(deletes).toEqual([
      'http://localhost:5030/api/v0/transfers/downloads/u1/01.flac?remove=false',
      'http://localhost:5030/api/v0/transfers/downloads/u1/?remove=false',
    ]);
    expect(ledger.removed).toHaveLength(2);
  });

  it('surfaces live progress while transferring and completes on the next poll', async () => {
    const progress: DownloadProgress[] = [];
    const { adapter } = downloader({
      polls: [
        poll([
          transfer('01.flac', {
            state: 'InProgress',
            size: 100,
            bytesTransferred: 50,
            placeInQueue: 3,
          }),
          transfer('02.flac', { state: 'InProgress', size: 100, bytesTransferred: 0 }),
        ]),
        bothSucceeded,
      ],
      events: [bothCompleted],
    });

    const result = await adapter.download(ACQ, candidate, policy(100000, 100000), (p) =>
      progress.push(p),
    );

    expect(result._unsafeUnwrap().kind).toBe('completed');
    expect(progress[0]).toMatchObject({ percent: 25, queuePosition: 3 });
    expect(progress.at(-1)?.percent).toBe(100);
  });

  it('falls back to the default poll interval when unconfigured', async () => {
    const http: HttpClient = {
      send: ({ method, url }) => {
        if (method === 'POST') return Promise.resolve({ status: 200, body: '' });
        if (url.includes('/api/v0/options')) return Promise.resolve(optionsResponse());
        if (url.includes('/api/v0/events')) return Promise.resolve(bothCompleted);
        return Promise.resolve(bothSucceeded);
      },
    };
    const adapter = new SlskdDownload(
      silentLogger(),
      new FakeResourceLedger(),
      { stagingRoot: STAGING },
      new SlskdClient(http),
    );

    const result = await adapter.download(ACQ, candidate, policy(1000, 1000), () => undefined);

    expect(result._unsafeUnwrap().kind).toBe('completed');
  });

  it('fails the candidate when a live slskd rejects the enqueue for an unreachable peer', async () => {
    const { adapter, ledger } = downloader({
      enqueue: {
        status: 500,
        body: 'Failed to establish a direct or indirect message connection to user',
      },
      polls: [],
    });

    const result = await adapter.download(ACQ, candidate, policy(1000, 1000), () => undefined);

    // slskd answered, so the infrastructure is up: the candidate failed, and the retry ladder
    // advances to the next peer instead of retrying this one forever (prod 2026-07-22).
    expect(result._unsafeUnwrap()).toEqual({ kind: 'failed', reason: 'PeerUnavailable' });
    // the write-ahead rows are released: nothing was created at the source
    expect(ledger.removed).toHaveLength(candidate.files.length);
  });

  it('fails the candidate as a generic transfer error for other enqueue rejections', async () => {
    const { adapter } = downloader({ enqueue: { status: 500, body: 'boom' }, polls: [] });

    const result = await adapter.download(ACQ, candidate, policy(1000, 1000), () => undefined);

    expect(result._unsafeUnwrap()).toEqual({ kind: 'failed', reason: 'TransferError' });
  });

  it('surfaces a transport fault during enqueue as an InfraError (slskd itself unreachable)', async () => {
    const { adapter } = downloader({ enqueueThrows: true, polls: [] });

    const result = await adapter.download(ACQ, candidate, policy(1000, 1000), () => undefined);

    expect(result._unsafeUnwrapErr()).toMatchObject({
      kind: 'InfraError',
      operation: 'slskd.download',
    });
  });

  it('treats a 404 mid-download poll as vanished transfers and stalls out, not an infra fault', async () => {
    const { adapter } = downloader({ polls: [{ status: 404, body: '' }] });

    const result = await adapter.download(ACQ, candidate, policy(200, 1000), () => undefined);

    expect(result._unsafeUnwrap()).toMatchObject({ kind: 'failed', reason: 'Stalled' });
  });

  it('surfaces a contract-violating poll body as an InfraError', async () => {
    const { adapter } = downloader({
      polls: [{ status: 200, body: JSON.stringify({ directories: 'not-an-array' }) }],
    });

    const result = await adapter.download(ACQ, candidate, policy(1000, 1000), () => undefined);

    expect(result._unsafeUnwrapErr()).toMatchObject({
      kind: 'InfraError',
      operation: 'slskd.download',
    });
  });

  it('records transfers write-ahead, captures their ids, and removes records on completion', async () => {
    const { adapter, deletes, ledger } = downloader({
      polls: [bothSucceeded],
      events: [bothCompleted],
    });

    const result = await adapter.download(ACQ, candidate, policy(1000, 1000), () => undefined);

    expect(result._unsafeUnwrap().kind).toBe('completed');
    expect(ledger.created.map((r) => r.resourceKey)).toEqual([
      'u1|@@a\\Album\\01.flac',
      'u1|@@a\\Album\\02.flac',
    ]);
    expect(ledger.ids.map((entry) => entry.id)).toEqual(['01.flac', '02.flac']);
    expect(deletes).toEqual([
      'http://localhost:5030/api/v0/transfers/downloads/u1/01.flac?remove=true',
      'http://localhost:5030/api/v0/transfers/downloads/u1/02.flac?remove=true',
    ]);
    expect(ledger.removed).toHaveLength(2);
  });

  it('dooms the candidate and cancels the remainder the moment one file fails', async () => {
    const { adapter, deletes, ledger } = downloader({
      polls: [
        poll([
          transfer('01.flac', { state: 'Completed, Errored', size: 100, bytesTransferred: 0 }),
          transfer('02.flac', { state: 'InProgress', size: 100, bytesTransferred: 30 }),
        ]),
        // The teardown re-poll: the failed file is already gone; the cancelled one is now terminal.
        poll([transfer('02.flac', { state: 'Completed, Cancelled' })]),
        poll([]),
      ],
    });

    // Generous policy timeouts: the failure — not a stall — is what ends the download.
    const result = await adapter.download(ACQ, candidate, policy(100000, 100000), () => undefined);

    // Neither file succeeded, so there is no partial subset to clean.
    expect(result._unsafeUnwrap()).toEqual({ kind: 'failed', reason: 'TransferError', files: [] });
    // The failed file (terminal) is removed at once; the in-flight one is cancelled then removed.
    expect(deletes).toEqual([
      'http://localhost:5030/api/v0/transfers/downloads/u1/01.flac?remove=true',
      'http://localhost:5030/api/v0/transfers/downloads/u1/02.flac?remove=false',
      'http://localhost:5030/api/v0/transfers/downloads/u1/02.flac?remove=true',
    ]);
    expect(ledger.removed).toHaveLength(2);
  });

  it('leaves a row live when a cancelled transfer never turns removable', async () => {
    // A single in-flight poll that never settles: every re-poll sees the same non-terminal state.
    const inFlight = poll([
      transfer('01.flac', { state: 'InProgress', size: 100, bytesTransferred: 50 }),
      transfer('02.flac', { state: 'InProgress', size: 100, bytesTransferred: 0 }),
    ]);
    const { adapter, deletes, ledger } = downloader({ polls: [inFlight] });

    const result = await adapter.download(ACQ, candidate, policy(50, 100000), () => undefined);

    expect(result._unsafeUnwrap()).toEqual({ kind: 'failed', reason: 'Stalled', files: [] });
    // Cancelled each round but never confirmed terminal, so no row is marked removed — the startup
    // sweep converges them next boot. Only cancels (remove=false) are ever issued.
    expect(deletes.every((url) => url.endsWith('?remove=false'))).toBe(true);
    expect(ledger.removed).toHaveLength(0);
  });

  it('reports the completed subset when a candidate is doomed mid-download', async () => {
    const { adapter } = downloader({
      polls: [
        poll([
          transfer('01.flac', { state: 'Completed, Succeeded', size: 100, bytesTransferred: 100 }),
          transfer('02.flac', { state: 'Completed, Errored', size: 100, bytesTransferred: 0 }),
        ]),
        poll([]),
      ],
      events: [eventsPage([{ id: '01.flac', local: localOf('01.flac') }])],
    });

    const result = await adapter.download(ACQ, candidate, policy(100000, 100000), () => undefined);

    // The already-staged file is surfaced for cleanup; the reported reason is the original failure.
    expect(result._unsafeUnwrap()).toEqual({
      kind: 'failed',
      reason: 'TransferError',
      files: [{ name: '01.flac', path: stagedPath('01.flac') }],
    });
  });

  it('still fails without files when the completed subset cannot be resolved (best-effort)', async () => {
    const { adapter } = downloader({
      polls: [
        poll([
          transfer('01.flac', { state: 'Completed, Succeeded', size: 100, bytesTransferred: 100 }),
          transfer('02.flac', { state: 'Completed, Errored', size: 100, bytesTransferred: 0 }),
        ]),
        poll([]),
      ],
      events: [eventsPage([])], // the events log never reports the completed file's location
    });

    const result = await adapter.download(ACQ, candidate, policy(100000, 100000), () => undefined);

    // Resolution failing does not turn the doomed failure into an infra fault — just no files.
    expect(result._unsafeUnwrap()).toEqual({
      kind: 'failed',
      reason: 'TransferError',
      files: [],
    });
  });

  it('skips a completed file whose transfer id was never captured', async () => {
    const { adapter } = downloader({
      polls: [
        poll([
          { filename: '@@a\\Album\\01.flac', state: 'Completed, Succeeded' }, // succeeded, but no id
          transfer('02.flac', { state: 'Completed, Errored', size: 100, bytesTransferred: 0 }),
        ]),
        poll([]),
      ],
    });

    const result = await adapter.download(ACQ, candidate, policy(100000, 100000), () => undefined);

    // Without an id the staged path cannot be resolved, so it is left out rather than mis-reported.
    expect(result._unsafeUnwrap()).toEqual({ kind: 'failed', reason: 'TransferError', files: [] });
  });

  it('still completes when removing a settled record fails, leaving the rows for the sweep', async () => {
    const { adapter, ledger } = downloader({
      deleteStatus: 500, // the cancel+remove DELETE errors, but the download already succeeded
      polls: [bothSucceeded],
      events: [bothCompleted],
    });

    const result = await adapter.download(ACQ, candidate, policy(1000, 1000), () => undefined);

    expect(result._unsafeUnwrap().kind).toBe('completed');
    // The records were never confirmed gone, so the rows stay live for the startup sweep to retire —
    // never falsely marked removed while a record lingers at the source (the bug this change fixes).
    expect(ledger.removed).toHaveLength(0);
  });

  it('completes even when ledger bookkeeping fails, leaving the ledger untouched', async () => {
    const { adapter, ledger } = downloader({ polls: [bothSucceeded], events: [bothCompleted] });
    ledger.fail = true;

    const result = await adapter.download(ACQ, candidate, policy(1000, 1000), () => undefined);

    expect(result._unsafeUnwrap().kind).toBe('completed');
    expect(ledger.created).toEqual([]);
  });

  it('drives an abandoned candidate’s in-flight transfers to fully removed at the source', async () => {
    // A stateful slskd double modelling the real cancel/remove guard (design D1): `?remove=true` on a
    // non-terminal transfer 500s; `?remove=false` cancels it (→ Completed, Cancelled); `?remove=true`
    // on a terminal transfer deletes the record. After teardown, no residual record must remain.
    const store = new Map<string, Record<string, unknown>>([
      [
        '01.flac',
        {
          id: '01.flac',
          filename: '@@a\\Album\\01.flac',
          state: 'InProgress',
          size: 100,
          bytesTransferred: 50,
        },
      ],
      [
        '02.flac',
        {
          id: '02.flac',
          filename: '@@a\\Album\\02.flac',
          state: 'InProgress',
          size: 100,
          bytesTransferred: 0,
        },
      ],
    ]);
    const http: HttpClient = {
      send: ({ method, url }) => {
        if (method === 'DELETE') {
          const match = /downloads\/u1\/([^?]*)\?remove=(true|false)/.exec(url)!;
          const id = decodeURIComponent(match[1]!);
          const transfer = store.get(id);
          if (transfer === undefined) return Promise.resolve({ status: 404, body: '' });
          const terminal = String(transfer.state).toLowerCase().includes('completed');
          if (match[2] === 'true') {
            if (!terminal) return Promise.resolve({ status: 500, body: 'not terminal' });
            store.delete(id);
          } else {
            transfer.state = 'Completed, Cancelled';
          }
          return Promise.resolve({ status: 204, body: '' });
        }
        return Promise.resolve(poll([...store.values()]));
      },
    };
    const ledger = new FakeResourceLedger();
    const adapter = new SlskdDownload(
      silentLogger(),
      ledger,
      { stagingRoot: STAGING, pollIntervalMs: 1 },
      new SlskdClient(http),
      fakeTimer(),
    );

    const result = await adapter.download(ACQ, candidate, policy(1, 100000), () => undefined);

    expect(result._unsafeUnwrap()).toMatchObject({ kind: 'failed', reason: 'Stalled' });
    // The source double is queried for residual records after teardown — none linger.
    expect(store.size).toBe(0);
    expect(ledger.removed).toHaveLength(2);
  });

  describe('abort', () => {
    it('cancels the candidate’s transfers, tolerating missing ids, then confirms them gone', async () => {
      const { adapter, deletes, ledger } = downloader({
        polls: [
          poll([
            transfer('01.flac', { state: 'InProgress', size: 100, bytesTransferred: 50 }),
            { filename: '@@a\\Album\\02.flac' }, // ours, but no id and no state yet
            { id: 'x', state: 'InProgress' }, // no filename → not one of ours
            { id: 'other', filename: '@@a\\Other\\99.flac', state: 'InProgress' }, // another dir
          ]),
          poll([]), // the teardown re-poll: both cancelled transfers are gone
        ],
      });

      const result = await adapter.abort(ACQ, candidate);

      expect(result._unsafeUnwrap()).toEqual([]); // nothing had completed into staging
      // In-flight transfers are cancelled (remove=false); the re-poll then finds them gone.
      expect(deletes).toEqual([
        'http://localhost:5030/api/v0/transfers/downloads/u1/01.flac?remove=false',
        'http://localhost:5030/api/v0/transfers/downloads/u1/?remove=false',
      ]);
      expect(ledger.removed).toHaveLength(2);
    });

    it('reports the subset already completed into staging so it can be cleaned', async () => {
      const { adapter, ledger } = downloader({
        polls: [
          poll([
            transfer('01.flac', { state: 'Completed, Succeeded' }), // already staged
            transfer('02.flac', { state: 'InProgress' }), // still in flight when cancelled
          ]),
          poll([]), // both gone after teardown
        ],
        events: [eventsPage([{ id: '01.flac', local: localOf('01.flac') }])],
      });

      const result = await adapter.abort(ACQ, candidate);

      // The completed file's source-reported staged path is returned for the domain to discard.
      expect(result._unsafeUnwrap()).toEqual([{ name: '01.flac', path: stagedPath('01.flac') }]);
      expect(ledger.removed).toHaveLength(2);
    });

    it('treats a 404 transfer listing as already-gone: nothing to abort, success (prod 2026-07-22)', async () => {
      // slskd 404s the downloads collection for a user with no transfers; for an abort that IS
      // the desired end state — converge instead of wedging the reactor on a retryable fault.
      const { adapter, deletes } = downloader({ polls: [{ status: 404, body: '' }] });

      const result = await adapter.abort(ACQ, candidate);

      expect(result._unsafeUnwrap()).toEqual([]);
      expect(deletes).toEqual([]);
    });

    it('is a no-op when the candidate has no transfers left', async () => {
      const { adapter, deletes } = downloader({ polls: [poll([])] });

      const result = await adapter.abort(ACQ, candidate);

      expect(result._unsafeUnwrap()).toEqual([]);
      expect(deletes).toEqual([]);
    });

    it('surfaces a contract-violating poll body as an InfraError', async () => {
      const { adapter } = downloader({
        polls: [{ status: 200, body: JSON.stringify({ directories: 'not-an-array' }) }],
      });

      const result = await adapter.abort(ACQ, candidate);

      expect(result._unsafeUnwrapErr()).toMatchObject({
        kind: 'InfraError',
        operation: 'slskd.abort',
      });
    });
  });
});
