import { err, ok } from 'neverthrow';
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
      const scannedTo = pending.length > 0 ? pending.at(-1)!.globalSeq : from;
      return Promise.resolve(ok({ events: pending, scannedTo }));
    },
  };
}

function subscriptionOver(
  feed: SeamFeed,
  handled: number[] = [],
): ReturnType<typeof catchUpSubscription> {
  return catchUpSubscription({
    name: 'seam:acquisitions',
    feed,
    checkpoints: new FakeCheckpointStore(),
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
  it("delivers the producer's events in position order, reading from the checkpoint", async () => {
    const handled: number[] = [];
    const feed = feedOf({ events: [event(1), event(2)] });
    const subscription = subscriptionOver(feed, handled);

    await subscription.start();

    expect(handled).toEqual([1, 2]);
    expect(feed.reads[0]).toBe(0); // a fresh consumer starts at the beginning
    await subscription.stop();
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
