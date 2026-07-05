import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { silentLogger } from '../../application/__fixtures__/fakes.js';
import type { Candidate } from '../../domain/candidate/candidate.js';
import type { DownloadPolicy } from '../../domain/policy/policies.js';
import type { DownloadProgress } from '../../application/ports/outbound-ports.js';
import { candidateStagingDir } from '../filesystem/paths.js';
import type { HttpClient, HttpResponse } from '../support/http.js';
import { SlskdClient } from './client.js';
import { SlskdDownload } from './download.js';
import type { Timer } from './timer.js';

const STAGING = '/staging';
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

interface Opts {
  enqueue?: HttpResponse;
  polls: HttpResponse[];
}

function downloader(opts: Opts): { adapter: SlskdDownload; deletes: string[] } {
  const deletes: string[] = [];
  const queue = [...opts.polls];
  const http: HttpClient = {
    send: ({ method, url }) => {
      if (method === 'POST') return Promise.resolve(opts.enqueue ?? { status: 200, body: '' });
      if (method === 'DELETE') {
        deletes.push(url);
        return Promise.resolve({ status: 204, body: '' });
      }
      const next = queue.length > 1 ? queue.shift() : queue[0];
      return Promise.resolve(next ?? { status: 200, body: '{"directories":[]}' });
    },
  };
  const adapter = new SlskdDownload(
    silentLogger(),
    { stagingRoot: STAGING, pollIntervalMs: 100 },
    new SlskdClient(http),
    fakeTimer(),
  );
  return { adapter, deletes };
}

function stagedPath(name: string): string {
  return join(candidateStagingDir(STAGING, candidate.identity), name);
}

describe('SlskdDownload', () => {
  it('aggregates a fully-transferred multi-file candidate into one completed outcome', async () => {
    const progress: DownloadProgress[] = [];
    const { adapter } = downloader({
      polls: [
        poll([
          transfer('01.flac', { state: 'Completed, Succeeded', size: 100, bytesTransferred: 100 }),
          transfer('02.flac', { state: 'Completed, Succeeded', size: 100, bytesTransferred: 100 }),
          { state: 'InProgress' }, // an unrelated transfer with no filename is ignored
        ]),
      ],
    });

    const result = await adapter.download(candidate, policy(1000, 1000), (p) => progress.push(p));

    expect(result._unsafeUnwrap()).toEqual({
      kind: 'completed',
      files: [
        { name: '01.flac', path: stagedPath('01.flac') },
        { name: '02.flac', path: stagedPath('02.flac') },
      ],
    });
    expect(progress.at(-1)?.percent).toBe(100);
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

    const result = await adapter.download(candidate, policy(1000, 1000), () => undefined);

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

    const result = await adapter.download(candidate, policy(1000, 1000), () => undefined);

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

    const result = await adapter.download(candidate, policy(50, 100000), () => undefined);

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

    const result = await adapter.download(candidate, policy(100000, 50), () => undefined);

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
        poll([
          transfer('01.flac', { state: 'Completed, Succeeded', size: 100, bytesTransferred: 100 }),
          transfer('02.flac', { state: 'Completed, Succeeded', size: 100, bytesTransferred: 100 }),
        ]),
      ],
    });

    const result = await adapter.download(candidate, policy(100000, 100000), (p) =>
      progress.push(p),
    );

    expect(result._unsafeUnwrap().kind).toBe('completed');
    expect(progress[0]).toMatchObject({ percent: 25, queuePosition: 3 });
    expect(progress.at(-1)?.percent).toBe(100);
  });

  it('falls back to the default poll interval when unconfigured', async () => {
    const http: HttpClient = {
      send: ({ method }) =>
        Promise.resolve(
          method === 'POST'
            ? { status: 200, body: '' }
            : poll([
                transfer('01.flac', {
                  state: 'Completed, Succeeded',
                  size: 100,
                  bytesTransferred: 100,
                }),
                transfer('02.flac', {
                  state: 'Completed, Succeeded',
                  size: 100,
                  bytesTransferred: 100,
                }),
              ]),
        ),
    };
    const adapter = new SlskdDownload(
      silentLogger(),
      { stagingRoot: STAGING },
      new SlskdClient(http),
    );

    const result = await adapter.download(candidate, policy(1000, 1000), () => undefined);

    expect(result._unsafeUnwrap().kind).toBe('completed');
  });

  it('surfaces an enqueue failure as an InfraError', async () => {
    const { adapter } = downloader({ enqueue: { status: 500, body: 'boom' }, polls: [] });

    const result = await adapter.download(candidate, policy(1000, 1000), () => undefined);

    expect(result._unsafeUnwrapErr()).toMatchObject({
      kind: 'InfraError',
      operation: 'slskd.download',
    });
  });
});
