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
  polls: HttpResponse[];
  events?: HttpResponse[];
  options?: HttpResponse;
  deleteStatus?: number; // status returned for record-removal DELETEs (default 204)
}

interface Harness {
  adapter: SlskdDownload;
  deletes: string[];
  ledger: FakeResourceLedger;
  counts: { options: number; events: number };
}

function drain(queue: HttpResponse[], fallback: HttpResponse): HttpResponse {
  return (queue.length > 1 ? queue.shift() : queue[0]) ?? fallback;
}

function downloader(opts: Opts): Harness {
  const deletes: string[] = [];
  const ledger = new FakeResourceLedger();
  const counts = { options: 0, events: 0 };
  const polls = [...opts.polls];
  // Default to a page that resolves the candidate's two transfers, so a succeeded outcome reports
  // its staged files without every test having to spell out the events stub.
  const events = [...(opts.events ?? [bothCompleted])];
  const http: HttpClient = {
    send: ({ method, url }) => {
      if (method === 'POST') return Promise.resolve(opts.enqueue ?? { status: 200, body: '' });
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

    expect(result._unsafeUnwrap()).toEqual({ kind: 'failed', reason: 'TransferError' });
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

    expect(result._unsafeUnwrap()).toEqual({ kind: 'failed', reason: 'PeerUnavailable' });
  });

  it('abandons a stalled transfer once the stall timeout elapses', async () => {
    const { adapter, deletes } = downloader({
      polls: [
        poll([
          transfer('01.flac', { state: 'InProgress', size: 100, bytesTransferred: 50 }),
          transfer('02.flac', { state: 'InProgress', size: 100, bytesTransferred: 0 }),
        ]),
      ],
    });

    const result = await adapter.download(ACQ, candidate, policy(50, 100000), () => undefined);

    expect(result._unsafeUnwrap()).toEqual({ kind: 'failed', reason: 'Stalled' });
    expect(deletes).toHaveLength(2);
  });

  it('abandons a hopelessly-queued transfer once the queue wait elapses', async () => {
    const { adapter, deletes } = downloader({
      polls: [
        poll([
          transfer('01.flac', { state: 'Queued, Remotely', size: 100, placeInQueue: 4 }),
          { filename: '@@a\\Album\\02.flac', state: 'Queued, Remotely', size: 100 }, // no id
        ]),
      ],
    });

    const result = await adapter.download(ACQ, candidate, policy(100000, 50), () => undefined);

    expect(result._unsafeUnwrap()).toEqual({ kind: 'failed', reason: 'QueueTimeout' });
    expect(deletes).toHaveLength(2);
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

  it('surfaces an enqueue failure as an InfraError', async () => {
    const { adapter } = downloader({ enqueue: { status: 500, body: 'boom' }, polls: [] });

    const result = await adapter.download(ACQ, candidate, policy(1000, 1000), () => undefined);

    expect(result._unsafeUnwrapErr()).toMatchObject({
      kind: 'InfraError',
      operation: 'slskd.download',
    });
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
      ],
    });

    // Generous policy timeouts: the failure — not a stall — is what ends the download.
    const result = await adapter.download(ACQ, candidate, policy(100000, 100000), () => undefined);

    expect(result._unsafeUnwrap()).toEqual({ kind: 'failed', reason: 'TransferError' });
    // Both the failed file and the still-in-flight one are cancelled and removed.
    expect(deletes).toEqual([
      'http://localhost:5030/api/v0/transfers/downloads/u1/01.flac?remove=true',
      'http://localhost:5030/api/v0/transfers/downloads/u1/02.flac?remove=true',
    ]);
    expect(ledger.removed).toHaveLength(2);
  });

  it('still completes when removing a settled record fails at the source', async () => {
    const { adapter, ledger } = downloader({
      deleteStatus: 500, // the cancel+remove DELETE errors, but the download already succeeded
      polls: [bothSucceeded],
      events: [bothCompleted],
    });

    const result = await adapter.download(ACQ, candidate, policy(1000, 1000), () => undefined);

    expect(result._unsafeUnwrap().kind).toBe('completed');
    // The ledger rows are still marked removed; the sweep will retire the leftover source records.
    expect(ledger.removed).toHaveLength(2);
  });

  it('completes even when ledger bookkeeping fails, leaving the ledger untouched', async () => {
    const { adapter, ledger } = downloader({ polls: [bothSucceeded], events: [bothCompleted] });
    ledger.fail = true;

    const result = await adapter.download(ACQ, candidate, policy(1000, 1000), () => undefined);

    expect(result._unsafeUnwrap().kind).toBe('completed');
    expect(ledger.created).toEqual([]);
  });

  describe('abort', () => {
    it('cancels and removes the candidate’s transfers, tolerating missing ids and filenames', async () => {
      const { adapter, deletes } = downloader({
        polls: [
          poll([
            transfer('01.flac', { state: 'InProgress', size: 100, bytesTransferred: 50 }),
            { filename: '@@a\\Album\\02.flac', state: 'Queued, Remotely' }, // ours, but no id
            { id: 'x', state: 'InProgress' }, // no filename → not one of ours
            { id: 'other', filename: '@@a\\Other\\99.flac', state: 'InProgress' }, // another dir
          ]),
        ],
      });

      const result = await adapter.abort(ACQ, candidate);

      expect(result._unsafeUnwrap()).toBeUndefined();
      expect(deletes).toEqual([
        'http://localhost:5030/api/v0/transfers/downloads/u1/01.flac?remove=true',
        'http://localhost:5030/api/v0/transfers/downloads/u1/?remove=true',
      ]);
    });

    it('is a no-op when the candidate has no transfers left', async () => {
      const { adapter, deletes } = downloader({ polls: [poll([])] });

      const result = await adapter.abort(ACQ, candidate);

      expect(result._unsafeUnwrap()).toBeUndefined();
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
