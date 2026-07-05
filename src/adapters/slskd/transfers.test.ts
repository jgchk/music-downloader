import { describe, expect, it } from 'vitest';
import { aggregate, flattenDownloads, reasonFromTransfer } from './transfers.js';

describe('flattenDownloads', () => {
  it('returns nothing for an absent payload', () => {
    expect(flattenDownloads(undefined)).toEqual([]);
  });

  it("flattens transfers across a user payload's directory groups, tolerating empty groups", () => {
    // slskd's `GET …/downloads/{username}` returns a single user object whose transfers are nested
    // under `directories` — not a bare array of directory groups (verified against slskd 0.22.5).
    const flat = flattenDownloads({
      username: 'nathan_988',
      directories: [
        { directory: 'a', files: [{ id: 't1' }, { id: 't2' }] },
        { directory: 'empty' },
      ],
    });

    expect(flat.map((t) => t.id)).toEqual(['t1', 't2']);
  });

  it('returns nothing when the payload carries no directories', () => {
    expect(flattenDownloads({ username: 'u', directories: [] })).toEqual([]);
  });
});

describe('reasonFromTransfer', () => {
  it('maps each Soulseek failure onto a source-agnostic reason', () => {
    expect(reasonFromTransfer({ state: 'Completed, Cancelled' })).toBe('Cancelled');
    expect(reasonFromTransfer({ state: 'Completed, Rejected' })).toBe('FileUnavailable');
    expect(reasonFromTransfer({ state: 'Completed, Errored', exception: 'User is offline' })).toBe(
      'PeerUnavailable',
    );
    expect(reasonFromTransfer({ exception: 'peer unavailable' })).toBe('PeerUnavailable');
    expect(reasonFromTransfer({ state: 'Completed, TimedOut' })).toBe('Stalled');
    expect(reasonFromTransfer({ state: 'Completed, Errored' })).toBe('TransferError');
  });
});

describe('aggregate', () => {
  it('reports a fully-succeeded, in-progress-aware snapshot', () => {
    const status = aggregate([
      { state: 'Completed, Succeeded', size: 100, bytesTransferred: 100 },
      { state: 'Completed, Succeeded', size: 100, bytesTransferred: 100 },
    ]);

    expect(status.settled).toBe(true);
    expect(status.succeeded).toBe(true);
    expect(status.allQueued).toBe(false);
    expect(status.progress).toEqual({
      percent: 100,
      bytesTransferred: 200,
      bytesTotal: 200,
      queuePosition: undefined,
    });
  });

  it('treats an empty transfer set as unsettled with zero progress', () => {
    const status = aggregate([]);

    expect(status).toMatchObject({
      settled: false,
      succeeded: false,
      allQueued: false,
      failureReason: 'TransferError',
      progress: { percent: 0, bytesTransferred: 0, bytesTotal: 0 },
    });
  });

  it('is settled-but-not-succeeded when a file fails, carrying the failure reason', () => {
    const status = aggregate([
      { state: 'Completed, Succeeded', size: 100, bytesTransferred: 100 },
      { state: 'Completed, Rejected', size: 100, bytesTransferred: 0 },
    ]);

    expect(status.settled).toBe(true);
    expect(status.succeeded).toBe(false);
    expect(status.failureReason).toBe('FileUnavailable');
  });

  it('flags an all-queued set and surfaces the earliest queue position', () => {
    const status = aggregate([
      { state: 'Queued, Remotely', size: 100, placeInQueue: 5 },
      { state: 'Queued, Remotely', size: 100 },
    ]);

    expect(status.allQueued).toBe(true);
    expect(status.settled).toBe(false);
    expect(status.progress.queuePosition).toBe(5);
    expect(status.progress.percent).toBe(0);
  });

  it('classifies in-progress and stateless transfers as neither settled nor queued', () => {
    const status = aggregate([
      { state: 'InProgress', size: 200, bytesTransferred: 50 },
      { size: 0 },
    ]);

    expect(status).toMatchObject({ settled: false, allQueued: false });
    expect(status.progress.percent).toBe(25);
  });
});
