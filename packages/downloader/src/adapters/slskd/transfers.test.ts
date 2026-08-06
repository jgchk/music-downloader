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

/**
 * Every stub below is a state the pinned slskd can actually produce, and the `exception` texts are
 * the spellings the recording lab witnessed (the scenario directories under
 * `test/contract/fixtures/slskd`). That matters more than it sounds: slskd 0.22.5 collapses
 * rejections, timeouts and dead peers alike into
 * `Completed, Errored`, so the *state* tells you almost nothing and the whole classification rests
 * on the exception text. Stubs that named `Completed, Rejected` and `Completed, TimedOut` used to
 * live here, testing a provider that cannot emit them.
 */
describe('reasonFromTransfer', () => {
  it('reads a cancellation from the one state slskd keeps distinct', () => {
    expect(
      reasonFromTransfer(
        {
          state: 'Completed, Cancelled',
          exception: 'The operation was canceled.',
        },
        'peer1',
      ),
    ).toBe('Cancelled');
  });

  it("reads a peer's refusal of the file as the file being unavailable", () => {
    expect(
      reasonFromTransfer(
        {
          state: 'Completed, Errored',
          exception: 'Transfer rejected: File not shared.',
        },
        'peer1',
      ),
    ).toBe('FileUnavailable');
  });

  it('reads a peer that dropped mid-transfer as the source being unavailable', () => {
    expect(
      reasonFromTransfer(
        {
          state: 'Completed, Errored',
          exception: 'Transfer failed: Read error: Remote connection closed',
        },
        'peer1',
      ),
    ).toBe('PeerUnavailable');
  });

  it('reads an offline peer as the source being unavailable', () => {
    expect(
      reasonFromTransfer(
        {
          state: 'Completed, Errored',
          exception: 'User peer1 appears to be offline',
        },
        'peer1',
      ),
    ).toBe('PeerUnavailable');
  });

  it('reads a timeout as a stall', () => {
    expect(
      reasonFromTransfer(
        {
          state: 'Completed, Errored',
          exception: 'The wait timed out after 15000 milliseconds',
        },
        'peer1',
      ),
    ).toBe('Stalled');
  });

  it('falls back to a generic transfer failure when the exception says nothing familiar', () => {
    expect(reasonFromTransfer({ state: 'Completed, Errored' }, 'peer1')).toBe('TransferError');
  });

  it('does not let a peer name itself into our own cancellation verdict', () => {
    // Every slskd failure text embeds the peer's self-chosen username, so free text is
    // attacker-shaped input. `Cancelled` is a fact this context authors about its OWN action —
    // a peer must never be able to assert it by being called something.
    expect(
      reasonFromTransfer(
        {
          state: 'Completed, Errored',
          exception: 'Failed to connect to user cancelbot: could not reach the peer',
        },
        'peer1',
      ),
    ).toBe('PeerUnavailable');
  });

  it('still classifies when the payload carries an exception but no state', () => {
    // Both fields are optional in the contract schema — slskd omitting one must degrade the read,
    // never blank it.
    expect(reasonFromTransfer({ exception: 'User peer1 appears to be offline' }, 'peer1')).toBe(
      'PeerUnavailable',
    );
  });
});

describe('aggregate', () => {
  it('reports a fully-succeeded, in-progress-aware snapshot', () => {
    const status = aggregate(
      [
        { state: 'Completed, Succeeded', size: 100, bytesTransferred: 100 },
        { state: 'Completed, Succeeded', size: 100, bytesTransferred: 100 },
      ],
      'peer1',
    );

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
    const status = aggregate([], 'peer1');

    expect(status).toMatchObject({
      succeeded: false,
      allQueued: false,
      failureReason: 'TransferError',
      progress: { percent: 0, bytesTransferred: 0, bytesTotal: 0 },
    });
  });

  it('reports not-succeeded when a file fails, carrying the failure reason', () => {
    const status = aggregate(
      [
        { state: 'Completed, Succeeded', size: 100, bytesTransferred: 100 },
        {
          state: 'Completed, Errored',
          exception: 'Transfer rejected: File not shared.',
          size: 100,
          bytesTransferred: 0,
        },
      ],
      'peer1',
    );

    expect(status.succeeded).toBe(false);
    expect(status.hasFailure).toBe(true);
    expect(status.failureReason).toBe('FileUnavailable');
  });

  it('flags a failure before the whole set terminates, to doom a candidate early', () => {
    const status = aggregate(
      [
        { state: 'Completed, Errored', size: 100, bytesTransferred: 0 },
        { state: 'InProgress', size: 100, bytesTransferred: 40 },
      ],
      'peer1',
    );

    expect(status.hasFailure).toBe(true);
    expect(status.failureReason).toBe('TransferError');
  });

  it('flags an all-queued set and surfaces the earliest queue position', () => {
    const status = aggregate(
      [
        { state: 'Queued, Remotely', size: 100, placeInQueue: 5 },
        { state: 'Queued, Remotely', size: 100 },
      ],
      'peer1',
    );

    expect(status.allQueued).toBe(true);
    expect(status.progress.queuePosition).toBe(5);
    expect(status.progress.percent).toBe(0);
  });

  it('classifies in-progress and stateless transfers as not all-queued', () => {
    const status = aggregate(
      [{ state: 'InProgress', size: 200, bytesTransferred: 50 }, { size: 0 }],
      'peer1',
    );

    expect(status).toMatchObject({ allQueued: false });
    expect(status.progress.percent).toBe(25);
  });
});

/**
 * The bodies here are verbatim from the recording lab. A rejected enqueue *often* leaves no
 * transfer row at all — slskd resolves the peer before it creates one — so for an offline or
 * unresponsive peer this string is the only account of the failure that will ever exist. Where a
 * row does also appear (a refused file), both must tell the same story: a peer rejecting a file is
 * the file being unavailable whether we learn it from the enqueue or from the row.
 *
 * On the pinned slskd these bodies all arrive with a 500 and are routed to the infrastructure path
 * before reaching this function — see its docblock, and the contract tier's
 * "answers every enqueue failure with a 500" test.
 */
describe('enqueueRejectionReason', () => {
  it("reads a peer's refusal of the file as the file being unavailable", () => {
    expect(
      enqueueRejectionReason(
        'One or more errors occurred. (Transfer rejected: File not shared.)',
        'peer1',
      ),
    ).toBe('FileUnavailable');
  });

  it('reads an offline peer as the source being unavailable', () => {
    expect(enqueueRejectionReason('User peer1 appears to be offline', 'peer1')).toBe(
      'PeerUnavailable',
    );
  });

  it('reads an unreachable peer as the source being unavailable', () => {
    expect(
      enqueueRejectionReason(
        'Failed to connect to user peer1: Failed to establish a direct or indirect message connection to peer1 (<peer-address>)',
        'peer1',
      ),
    ).toBe('PeerUnavailable');
  });

  it('reads a peer that never answered as a stall, not a generic failure', () => {
    expect(
      enqueueRejectionReason(
        'One or more errors occurred. (One or more errors occurred. (The wait timed out after 15000 milliseconds))',
        'peer1',
      ),
    ).toBe('Stalled');
  });

  it('still reads a failure when the peer name is empty', () => {
    // `replaceAll('')` interleaves the replacement between every character, which would turn every
    // rejection into an unrecognised one. The guard keeps a nameless caller from blinding the read.
    expect(enqueueRejectionReason('User someone appears to be offline', '')).toBe(
      'PeerUnavailable',
    );
  });

  it('reads past a peer that named itself after a failure', () => {
    // The name is the one span of the sentence a peer chooses, so it is removed before the read.
    // Without that, `transfer rejected: lol` calling itself offline reports the wrong failure.
    expect(
      enqueueRejectionReason(
        'User transfer rejected: lol appears to be offline',
        'transfer rejected: lol',
      ),
    ).toBe('PeerUnavailable');
  });

  it('never reports a refused enqueue as our own cancellation', () => {
    // An enqueue slskd refused is not something we cancelled, so this path cannot produce
    // `Cancelled` at all — least of all because the peer chose a name containing the word.
    expect(enqueueRejectionReason('User cancelbot appears to be offline', 'peer1')).toBe(
      'PeerUnavailable',
    );
    expect(
      enqueueRejectionReason('One or more errors occurred. (Cancelled by cancelbot)', 'peer1'),
    ).not.toBe('Cancelled');
  });

  it('falls back to a generic transfer failure for other rejection bodies', () => {
    expect(enqueueRejectionReason('boom', 'peer1')).toBe('TransferError');
    expect(enqueueRejectionReason('', 'peer1')).toBe('TransferError');
  });
});
