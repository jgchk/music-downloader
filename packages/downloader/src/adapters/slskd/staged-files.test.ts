import { describe, expect, it } from 'vitest';
import { silentLogger } from '../../application/__fixtures__/fakes.js';
import { asCandidateIdentity } from '../../domain/shared/__fixtures__/candidate-identity.js';
import type { Candidate } from '../../domain/candidate/candidate.js';
import type { HttpClient, HttpResponse } from '../support/http.js';
import { SlskdClient } from './client.js';
import { StagedFileResolver } from './staged-files.js';
import type { Timer } from './timer.js';
import type { OwnedTransfer } from './transfers.js';

/**
 * The resolver reads slskd's *newest-first* activity log to learn where slskd actually wrote each
 * completed file. Two things about that log drive everything here: a page holds only the newest 100
 * records (so our completions may sit behind older ones), and a completion event can lag the
 * transfer-state flip that sent us looking for it (so an exhausted log is a "not yet", not a "no").
 * The scan's offsets are what distinguish those two readings, which is why they are asserted.
 */

const DOWNLOADS_ROOT = '/downloads';
const STAGING = '/staging';
const EVENTS_PAGE_LIMIT = 100;

const candidate: Candidate = {
  identity: asCandidateIdentity({ username: 'u1', path: String.raw`@@a\Album`, sizeBytes: 200 }),
  files: [
    { name: '01.flac', sizeBytes: 100 },
    { name: '02.flac', sizeBytes: 100 },
  ],
  source: { speedBytesPerSec: 0, freeSlots: 1, queueLength: 0 },
};

function succeeded(name: string): OwnedTransfer {
  return { id: name, filename: `@@a\\Album\\${name}`, state: 'Completed, Succeeded' };
}

/** Where slskd reports having written a file, under its own container downloads root. */
function localOf(name: string): string {
  return `${DOWNLOADS_ROOT}/Album/${name}`;
}

/** The same bytes as we see them, on the shared staging volume. */
function stagedOf(name: string): string {
  return `${STAGING}/Album/${name}`;
}

/** One page of the events log: a `DownloadFileComplete` record per named completion. */
function page(...ids: string[]): HttpResponse {
  return {
    status: 200,
    body: JSON.stringify(
      ids.map((id) => ({
        type: 'DownloadFileComplete',
        data: JSON.stringify({ localFilename: localOf(id), transfer: { id } }),
      })),
    ),
  };
}

interface Harness {
  resolver: StagedFileResolver;
  /** The `offset` of each events read, in order — the scan's path through the log. */
  offsets: number[];
  requestCount: () => number;
}

/** A resolver whose events pages are served in request order (the last one repeats). */
function resolverOver(pages: HttpResponse[]): Harness {
  const offsets: number[] = [];
  const queue = [...pages];
  let requests = 0;
  const http: HttpClient = {
    send: ({ url }) => {
      requests += 1;
      if (url.includes('/api/v0/options')) {
        return Promise.resolve({
          status: 200,
          body: JSON.stringify({ directories: { downloads: DOWNLOADS_ROOT } }),
        });
      }
      offsets.push(Number(new URL(url).searchParams.get('offset')));
      return Promise.resolve(queue.length > 1 ? queue.shift()! : (queue[0] ?? page()));
    },
  };
  const timer: Timer = { now: () => 0, sleep: () => Promise.resolve() };
  return {
    resolver: new StagedFileResolver(silentLogger(), new SlskdClient(http), timer, STAGING, 10),
    offsets,
    requestCount: () => requests,
  };
}

describe('StagedFileResolver', () => {
  it('walks older pages of the log until every completed transfer has a path', async () => {
    // Only one of ours is on the newest page; the other is further back, so the scan asks for the
    // next page rather than concluding the file was never written.
    const { resolver, offsets } = resolverOver([page('01.flac'), page('02.flac')]);

    const files = await resolver.stagedFiles(
      [succeeded('01.flac'), succeeded('02.flac')],
      candidate,
    );

    expect(files).toEqual([
      { name: '01.flac', path: stagedOf('01.flac') },
      { name: '02.flac', path: stagedOf('02.flac') },
    ]);
    expect(offsets).toEqual([0, EVENTS_PAGE_LIMIT]);
  });

  it('re-scans from the head of the log when a completion event lags behind the transfer', async () => {
    // The log is exhausted with our file still unaccounted for: slskd has flipped the transfer to
    // completed but has not written the event yet, so the scan waits and starts again at the head —
    // where a newly written event will be — instead of reading further into history.
    const { resolver, offsets } = resolverOver([page(), page('01.flac')]);

    const files = await resolver.stagedFiles([succeeded('01.flac')], candidate);

    expect(files).toEqual([{ name: '01.flac', path: stagedOf('01.flac') }]);
    expect(offsets).toEqual([0, 0]);
  });

  it('gives up after a bounded wait, saying how many files the log never reported', async () => {
    // The lag window is not open-ended: the download's own retry is the longer loop, so the
    // resolver reports what is missing rather than waiting for it forever.
    const { resolver, offsets } = resolverOver([page('01.flac'), page()]);

    await expect(
      resolver.stagedFiles([succeeded('01.flac'), succeeded('02.flac')], candidate),
    ).rejects.toThrow('slskd events did not report 1 completed file(s)');
    // Paged once to exhaust the log, then five re-scans from the head — the bound.
    expect(offsets).toEqual([0, EVENTS_PAGE_LIMIT, 0, 0, 0, 0]);
  });

  it('resolves nothing, without asking slskd anything, when no transfer completed', async () => {
    // An abandoned candidate whose files all failed has nothing staged to clean up, so neither the
    // options read nor the log scan has a question to ask.
    const { resolver, requestCount } = resolverOver([page()]);
    const failed: OwnedTransfer = {
      id: '01.flac',
      filename: String.raw`@@a\Album\01.flac`,
      state: 'Completed, Errored',
    };

    await expect(resolver.completedStagedFiles([failed], candidate)).resolves.toEqual([]);
    expect(requestCount()).toBe(0);
  });
});
