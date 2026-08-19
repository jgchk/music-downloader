import { ResultAsync, err, ok } from 'neverthrow';
import { describe, expect, it } from 'vitest';
import { FakeCheckpointStore, silentLogger } from '../__fixtures__/fakes.js';
import { catchUpSubscription } from './catch-up-subscription.js';
import type { SeamEvent, SeamFeed } from './catch-up-subscription.js';

/**
 * The subscription's own job is the TRANSLATION at this side of the seam: the producer's wire shape
 * into the drain's, and the producer's error vocabulary into the drain's classification. The drain
 * mechanism itself (resume, coalesce, retry, hold, halt, reset) is `@music/eventing`'s and is tested
 * there, so what is asserted here is only what would break if this adapter were wrong.
 */

const event = (globalSeq: number): SeamEvent => ({
  globalSeq,
  type: 'acquisition.fulfilled',
  timestamp: 'T0',
  data: { globalSeq },
});

/** A feed that answers with `events` (positions past `from`) or always fails with `failure`. */
function feedOf(options: {
  events?: readonly SeamEvent[];
  failure?: { readonly kind: string };
  scannedTo?: number;
}): SeamFeed & { reads: number[] } {
  const reads: number[] = [];
  return {
    reads,
    read: (from, limit) => {
      reads.push(from);
      if (options.failure !== undefined) return Promise.resolve(err(options.failure));
      const pending = (options.events ?? [])
        .filter((event) => event.globalSeq > from)
        .slice(0, limit);
      const lastPublished = pending.length > 0 ? pending.at(-1)!.globalSeq : from;
      return Promise.resolve(
        ok({ events: pending, scannedTo: options.scannedTo ?? lastPublished }),
      );
    },
  };
}

let checkpoints: FakeCheckpointStore;

function subscriptionOver(
  feed: SeamFeed,
  handled: number[] = [],
): ReturnType<typeof catchUpSubscription> {
  checkpoints = new FakeCheckpointStore();
  return catchUpSubscription({
    name: 'seam:acquisitions',
    feed,
    checkpoints,
    handler: (delivered) => {
      handled.push(delivered.globalSeq);
      return Promise.resolve(ok(undefined));
    },
    logger: silentLogger(),
    tuning: {
      retry: { attempts: 1, baseDelayMs: 0 },
      sleep: () => Promise.resolve(),
      interval: () => () => {},
    },
  });
}

describe('the catch-up subscription over the downloader feed', () => {
  it("delivers the producer's events and checkpoints each one at its own position", async () => {
    // The checkpoint assertion is the point: the adapter's `positionOf` is what tells the drain
    // WHERE each event sits, and a mapping that answered a constant would replay the producer's
    // whole history on every restart while every delivery assertion stayed green.
    const handled: number[] = [];
    const subscription = subscriptionOver(feedOf({ events: [event(1), event(2)] }), handled);

    await subscription.start();

    expect(handled).toEqual([1, 2]);
    expect(checkpoints.peek('seam:acquisitions')).toBe(2);
    await subscription.stop();
  });

  it("carries the producer's scanned window through, so a gap it published nothing in is not re-read", async () => {
    // `scannedTo` is the other half of the wire mapping. Dropped, the checkpoint would stall at the
    // last delivered event and the drain would re-read the empty gap on every cycle forever.
    const subscription = subscriptionOver(feedOf({ events: [event(1)], scannedTo: 50 }));

    await subscription.start();

    expect(checkpoints.peek('seam:acquisitions')).toBe(50);
    await subscription.stop();
  });

  it("reports a rejecting checkpoint store in THIS module's error vocabulary", async () => {
    // A store that rejects instead of answering with a Result is a defect, but it must still reach
    // the caller as an `InfraError` — the drain's own error type never travels a channel this
    // module declared as its own, or a caller narrowing on `kind` falls through at runtime.
    const rejecting = {
      load: (name: string) => checkpoints.load(name),
      save: () => ResultAsync.fromSafePromise<void>(Promise.reject(new Error('store gone'))),
    };
    const subscription = catchUpSubscription({
      name: 'seam:acquisitions',
      feed: feedOf({}),
      checkpoints: rejecting,
      handler: () => Promise.resolve(ok(undefined)),
      logger: silentLogger(),
    });

    const outcome = await subscription.reset(0);

    expect(outcome._unsafeUnwrapErr()).toMatchObject({
      kind: 'InfraError',
      operation: 'checkpoint.reset',
    });
  });

  it('halts on the permanent render kind the producer publishes', async () => {
    // The one feed error retrying can never resolve. The kind travels as a bare string (importing
    // the producer's error type would be a shared kernel), so the contract tier pins the literal
    // against the producer's declared `seam-contract.json`; what is pinned here is that a permanent
    // classification reaches the drain at all.
    const subscription = subscriptionOver(feedOf({ failure: { kind: 'RenderError' } }));

    await subscription.start();

    expect(subscription.isHalted).toBe(true);
    await subscription.stop();
  });

  it('holds rather than halts on every other feed error kind', async () => {
    // The other half: a store blip must stay retryable, or it would take the module down until an
    // operator reset it.
    const subscription = subscriptionOver(feedOf({ failure: { kind: 'InfraError' } }));

    await subscription.start();

    expect(subscription.isHalted).toBe(false);
    await subscription.stop();
  });
});
