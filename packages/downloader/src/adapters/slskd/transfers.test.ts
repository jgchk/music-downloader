import { describe, expect, it } from 'vitest';
import {
  aggregate,
  enqueueRejectionReason,
  flattenDownloads,
  reasonFromTransfer,
} from './transfers.js';

describe('flattenDownloads', () => {
  it('returns nothing when the payload omits directories', () => {
    expect(flattenDownloads({})).toEqual([]);
  });

  it("flattens transfers across a user payload's directory groups, tolerating empty groups", () => {
    // slskd's `GET …/downloads/{username}` returns a single user object whose transfers are nested
    // under `directories` — not a bare array of directory groups (verified against slskd 0.22.5).
    // The user/directory wrapper keys are stripped by the contract schema before this runs, so the
    // input here mirrors the post-parse shape.
    const flat = flattenDownloads({
      directories: [{ files: [{ id: 't1' }, { id: 't2' }] }, {}],
    });

    expect(flat.map((t) => t.id)).toEqual(['t1', 't2']);
  });

  it('returns nothing when the payload carries no directories', () => {
    expect(flattenDownloads({ directories: [] })).toEqual([]);
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

    expect(status.succeeded).toBe(true);
    expect(status.allQueued).toBe(false);
    expect(status.progress).toEqual({
      percent: 100,
      bytesTransferred: 200,
      bytesTotal: 200,
      queuePosition: undefined,
    });
  });

  it('treats an empty transfer set as neither succeeded nor queued, with zero progress', () => {
    const status = aggregate([]);

    expect(status).toMatchObject({
      succeeded: false,
      allQueued: false,
      failureReason: 'TransferError',
      progress: { percent: 0, bytesTransferred: 0, bytesTotal: 0 },
    });
  });

  it('reports not-succeeded when a file fails, carrying the failure reason', () => {
    const status = aggregate([
      { state: 'Completed, Succeeded', size: 100, bytesTransferred: 100 },
      { state: 'Completed, Rejected', size: 100, bytesTransferred: 0 },
    ]);

    expect(status.succeeded).toBe(false);
    expect(status.hasFailure).toBe(true);
    expect(status.failureReason).toBe('FileUnavailable');
  });

  it('flags a failure before the whole set terminates, to doom a candidate early', () => {
    const status = aggregate([
      { state: 'Completed, Errored', size: 100, bytesTransferred: 0 },
      { state: 'InProgress', size: 100, bytesTransferred: 40 },
    ]);

    expect(status.hasFailure).toBe(true);
    expect(status.failureReason).toBe('TransferError');
  });

  it('flags an all-queued set and surfaces the earliest queue position', () => {
    const status = aggregate([
      { state: 'Queued, Remotely', size: 100, placeInQueue: 5 },
      { state: 'Queued, Remotely', size: 100 },
    ]);

    expect(status.allQueued).toBe(true);
    expect(status.progress.queuePosition).toBe(5);
    expect(status.progress.percent).toBe(0);
  });

  it('classifies in-progress and stateless transfers as not all-queued', () => {
    const status = aggregate([
      { state: 'InProgress', size: 200, bytesTransferred: 50 },
      { size: 0 },
    ]);

    expect(status).toMatchObject({ allQueued: false });
    expect(status.progress.percent).toBe(25);
  });
});

describe('enqueueRejectionReason', () => {
  it('names the peer when the rejection body is connection-flavored', () => {
    expect(
      enqueueRejectionReason('Failed to establish a direct or indirect message connection to u'),
    ).toBe('PeerUnavailable');
    expect(enqueueRejectionReason('User u appears to be offline')).toBe('PeerUnavailable');
    expect(enqueueRejectionReason('peer unavailable')).toBe('PeerUnavailable');
  });

  it('falls back to a generic transfer failure for other rejection bodies', () => {
    expect(enqueueRejectionReason('boom')).toBe('TransferError');
    expect(enqueueRejectionReason('')).toBe('TransferError');
  });
});
