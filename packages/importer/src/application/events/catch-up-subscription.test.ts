import { ResultAsync, err, ok } from 'neverthrow';
import type { Result } from 'neverthrow';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { FakeCheckpointStore, FakeDeadLetterStore, silentLogger } from '../__fixtures__/fakes.js';
import { createLogger } from '../logging/logger.js';
import { infraError } from '../ports/errors.js';
import { CatchUpSubscription } from './catch-up-subscription.js';
import type {
  CatchUpSubscriptionDependencies,
  ConsumeFailure,
  SeamEvent,
  SeamFeedBatch,
} from './catch-up-subscription.js';

/** An in-memory feed of published events, addressed by gapless global position. */
class FakeFeed {
  public events: SeamEvent[] = [];
  public failReads = false;

  read(fromGlobalSeq: number, limit: number): Promise<Result<SeamFeedBatch, { kind: string }>> {
    if (this.failReads) return Promise.resolve(err({ kind: 'InfraError' }));
    const pending = this.events.filter((event) => event.globalSeq > fromGlobalSeq).slice(0, limit);
    const scannedTo = pending.length > 0 ? pending.at(-1)!.globalSeq : fromGlobalSeq;
    return Promise.resolve(ok({ events: pending, scannedTo }));
  }
}

function seamEvent(globalSeq: number, type = 'acquisition.fulfilled'): SeamEvent {
  return { globalSeq, type, timestamp: 'T0', data: { globalSeq } };
}

let feed: FakeFeed;
let checkpoints: FakeCheckpointStore;
let deadLetters: FakeDeadLetterStore;
let handled: number[];
let failures: Map<number, ConsumeFailure[]>;
let sleeps: number[];
let wakeListeners: (() => void)[];
let intervals: { fn: () => void; ms: number; stopped: boolean }[];

beforeEach(() => {
  feed = new FakeFeed();
  checkpoints = new FakeCheckpointStore();
  deadLetters = new FakeDeadLetterStore();
  handled = [];
  failures = new Map();
  sleeps = [];
  wakeListeners = [];
  intervals = [];
});

function subscription(
  overrides: Partial<CatchUpSubscriptionDependencies> = {},
): CatchUpSubscription {
  return new CatchUpSubscription({
    name: 'seam:test',
    feed,
    checkpoints,
    deadLetters,
    handler: (event) => {
      const queued = failures.get(event.globalSeq);
      const next = queued?.shift();
      if (next !== undefined) return Promise.resolve(err(next));
      handled.push(event.globalSeq);
      return Promise.resolve(ok(undefined));
    },
    policy: 'halt',
    logger: silentLogger(),
    clock: { now: () => new Date('2026-07-21T12:00:00.000Z') },
    retry: { attempts: 3, baseDelayMs: 100 },
    batchSize: 2,
    pollIntervalMs: 5000,
    sleep: (ms) => {
      sleeps.push(ms);
      return Promise.resolve();
    },
    wakeups: {
      subscribe: (listener) => {
        wakeListeners.push(listener);
        return () => wakeListeners.splice(wakeListeners.indexOf(listener), 1);
      },
    },
    interval: (function_, ms) => {
      const entry = { fn: function_, ms, stopped: false };
      intervals.push(entry);
      return () => {
        entry.stopped = true;
      };
    },
    ...overrides,
  });
}

async function checkpointOf(name = 'seam:test'): Promise<number> {
  const loadResult = await checkpoints.load(name);
  return loadResult._unsafeUnwrap();
}

describe('CatchUpSubscription', () => {
  it('drains the backlog on start, in order, and checkpoints each processed event', async () => {
    feed.events = [seamEvent(1), seamEvent(2), seamEvent(3)];
    const sub = subscription();

    await sub.start();

    expect(handled).toEqual([1, 2, 3]);
    expect(await checkpointOf()).toBe(3);
  });

  it('resumes strictly after its persisted checkpoint on restart', async () => {
    feed.events = [seamEvent(1), seamEvent(2), seamEvent(3)];
    await checkpoints.save('seam:test', 2);
    const sub = subscription();

    await sub.start();

    expect(handled).toEqual([3]);
  });

  it('a wakeup is only a hint — the fallback poll alone still delivers', async () => {
    const sub = subscription();
    await sub.start();
    feed.events = [seamEvent(1)];

    // The producer's wakeup is lost; the registered fallback interval fires instead.
    expect(intervals).toHaveLength(1);
    intervals[0]!.fn();
    await vi.waitFor(() => {
      expect(handled).toEqual([1]);
    });
    expect(await checkpointOf()).toBe(1);
  });

  it('a wakeup delivers promptly without waiting for the interval', async () => {
    const sub = subscription();
    await sub.start();
    feed.events = [seamEvent(1)];

    for (const listener of wakeListeners) {
      listener();
    }

    await vi.waitFor(() => {
      expect(handled).toEqual([1]);
    });
  });

  it('a crash between produce and consume redelivers: a fresh instance resumes from the checkpoint', async () => {
    feed.events = [seamEvent(1)];
    await subscription().start();
    feed.events.push(seamEvent(2)); // committed by the producer, never seen before the "crash"

    const recovered = subscription();
    await recovered.start();

    expect(handled).toEqual([1, 2]);
    expect(await checkpointOf()).toBe(2);
  });

  it('retries a transient failure with backoff, then holds the checkpoint for the next cycle', async () => {
    feed.events = [seamEvent(1), seamEvent(2)];
    failures.set(1, [
      { kind: 'Transient', reason: 'IntakeDirectoryMissing' },
      { kind: 'Transient', reason: 'IntakeDirectoryMissing' },
      { kind: 'Transient', reason: 'IntakeDirectoryMissing' },
    ]);
    const sub = subscription();

    await sub.start();

    // Three in-place attempts (backoff 100, 200), exhaustion holds — order preserved, 2 unprocessed.
    expect(sleeps.filter((ms) => ms > 0)).toEqual([100, 200]);
    expect(handled).toEqual([]);
    expect(await checkpointOf()).toBe(0);

    // The next cycle redelivers; the transient world has healed and both events flow.
    await sub.poll();
    expect(handled).toEqual([1, 2]);
    expect(await checkpointOf()).toBe(2);
  });

  it('halt policy: a poison event stops the subscription without advancing', async () => {
    feed.events = [seamEvent(1), seamEvent(2)];
    failures.set(1, [{ kind: 'Permanent', reason: 'InvalidPayload' }]);
    const sub = subscription();

    await sub.start();

    expect(sub.isHalted).toBe(true);
    expect(handled).toEqual([]);
    expect(await checkpointOf()).toBe(0);

    // Halted: later polls are inert until an operator intervenes.
    await sub.poll();
    expect(handled).toEqual([]);
  });

  it('park policy: a poison event is dead-lettered in the consumer store and skipped', async () => {
    feed.events = [seamEvent(1), seamEvent(2)];
    failures.set(1, [{ kind: 'Permanent', reason: 'OutsideSourceRoot' }]);
    const sub = subscription({ policy: 'park' });

    await sub.start();

    expect(handled).toEqual([2]);
    expect(await checkpointOf()).toBe(2);
    expect(deadLetters.letters).toEqual([
      {
        subscription: 'seam:test',
        globalSeq: 1,
        error: 'OutsideSourceRoot',
        occurredAt: '2026-07-21T12:00:00.000Z',
      },
    ]);
  });

  it('park holds the checkpoint when the dead-letter write itself fails', async () => {
    feed.events = [seamEvent(1)];
    failures.set(1, [{ kind: 'Permanent', reason: 'InvalidPayload' }]);
    deadLetters.failRecord = true;
    const sub = subscription({ policy: 'park' });

    await sub.start();

    expect(await checkpointOf()).toBe(0);
    expect(sub.isHalted).toBe(false);
  });

  it('subscriptions are isolated: one halting does not stop another', async () => {
    feed.events = [seamEvent(1)];
    failures.set(1, [{ kind: 'Permanent', reason: 'InvalidPayload' }]);
    const halted = subscription();
    const healthy = subscription({ name: 'seam:other' });

    await halted.start();
    await healthy.start();

    expect(halted.isHalted).toBe(true);
    expect(await checkpointOf('seam:other')).toBe(1);
    expect(handled).toEqual([1]);
  });

  it('a feed read failure holds the checkpoint and recovers on a later cycle', async () => {
    feed.events = [seamEvent(1)];
    feed.failReads = true;
    const sub = subscription();

    await sub.start();
    expect(await checkpointOf()).toBe(0);

    feed.failReads = false;
    await sub.poll();
    expect(handled).toEqual([1]);
  });

  it('halts on a permanent render defect at the feed boundary rather than retrying forever', async () => {
    // A RenderError is a producer mapping defect a retry can never fix: distinguish it from a
    // transient store-read fault. Holding-and-retrying would block this position — and every
    // verdict behind it — forever with readiness still `up`; halting surfaces it (readiness down).
    const renderDefectFeed = {
      read: (): Promise<Result<SeamFeedBatch, { kind: string }>> =>
        Promise.resolve(err({ kind: 'RenderError' })),
    };
    const sub = subscription({ feed: renderDefectFeed });

    await sub.start();

    expect(sub.isHalted).toBe(true);
    expect(await checkpointOf()).toBe(0); // held, never skipped
  });

  it('halts on a faulted checkpoint read instead of replaying the whole feed from zero', async () => {
    feed.events = [seamEvent(1)];
    checkpoints.failLoad = true;
    const logger = silentLogger();
    const errorSpy = vi.spyOn(logger, 'error');
    const sub = subscription({ logger });

    await sub.start();

    // A faulted read knows nothing about what this consumer has already seen; treating it as
    // "fresh consumer at 0" would redeliver the producer's entire history behind a healthy-
    // looking readiness. Nothing is delivered, and the module reports itself down.
    expect(handled).toEqual([]);
    expect(sub.isHalted).toBe(true);
    expect(errorSpy).toHaveBeenCalledWith(
      { subscription: 'seam:test', err: infraError('checkpoint.load', 'boom') },
      'checkpoint load failed; subscription halted without delivering (position unknown)',
    );
  });

  it('a checkpoint save failure holds delivery rather than losing it', async () => {
    feed.events = [seamEvent(1)];
    checkpoints.failSaves = true;
    const sub = subscription();

    await sub.start();

    expect(await checkpointOf()).toBe(0);

    checkpoints.failSaves = false;
    await sub.poll();
    // Redelivered (at-least-once); the handler ran twice and the checkpoint caught up.
    expect(handled).toEqual([1, 1]);
    expect(await checkpointOf()).toBe(1);
  });

  it('drains in bounded batches, yielding between them', async () => {
    feed.events = [seamEvent(1), seamEvent(2), seamEvent(3), seamEvent(4), seamEvent(5)];
    const sub = subscription();

    await sub.start();

    expect(handled).toEqual([1, 2, 3, 4, 5]);
    // batchSize 2 → three read cycles, a zero-delay yield after each completed batch.
    expect(sleeps.filter((ms) => ms === 0).length).toBeGreaterThanOrEqual(2);
  });

  it('holds when the trailing-scan checkpoint advance fails', async () => {
    checkpoints.failSaves = true;
    const sub = subscription({
      feed: { read: (from: number) => Promise.resolve(ok({ events: [], scannedTo: from + 5 })) },
    });

    await sub.start();

    expect(await checkpointOf()).toBe(0);
    expect(sub.isHalted).toBe(false); // held, not poisoned — the next cycle retries
  });

  it('advances the checkpoint past batches that contain no published events', async () => {
    const sub = subscription({
      feed: {
        read: (from: number) => Promise.resolve(ok({ events: [], scannedTo: Math.max(from, 7) })),
      },
    });

    await sub.start();

    expect(await checkpointOf()).toBe(7);
  });

  it('concurrent polls coalesce instead of interleaving', async () => {
    feed.events = [seamEvent(1)];
    const sub = subscription();
    await sub.start();
    feed.events.push(seamEvent(2));

    await Promise.all([sub.poll(), sub.poll(), sub.poll()]);

    expect(handled).toEqual([1, 2]);
  });

  it('reset replays the feed from the start and idempotent handling converges', async () => {
    feed.events = [seamEvent(1), seamEvent(2)];
    const sub = subscription();
    await sub.start();

    await sub.reset();
    await sub.poll();

    expect(handled).toEqual([1, 2, 1, 2]);
    expect(await checkpointOf()).toBe(2);
  });

  it('reset reports a checkpoint-save failure instead of claiming the replay was recorded', async () => {
    feed.events = [seamEvent(1), seamEvent(2)];
    const sub = subscription();
    await sub.start();
    checkpoints.failSaves = true;

    const outcome = await sub.reset();

    expect(outcome.isErr()).toBe(true);
    expect(await checkpointOf()).toBe(2);
  });

  it('a reset whose checkpoint save failed leaves the subscription where the durable checkpoint says', async () => {
    feed.events = [seamEvent(1)];
    failures.set(1, [{ kind: 'Permanent', reason: 'InvalidPayload' }]);
    const sub = subscription();
    await sub.start();
    checkpoints.failSaves = true;

    await sub.reset();

    expect(sub.isHalted).toBe(true);
  });

  it('a failed reset leaves the in-memory cursor on the durable checkpoint, not the requested one', async () => {
    feed.events = [seamEvent(1), seamEvent(2)];
    const sub = subscription();
    await sub.start();
    checkpoints.failSaves = true;

    const outcome = await sub.reset();
    checkpoints.failSaves = false;
    await sub.poll();

    // Moving the cursor before the save lands would replay everything the durable checkpoint
    // still covers — on a reset the operator was explicitly told had failed.
    expect(outcome.isErr()).toBe(true);
    expect(handled).toEqual([1, 2]);
  });

  it('reset waits out an in-flight drain, so its Ok arm is the durable truth', async () => {
    feed.events = [seamEvent(1), seamEvent(2)];
    const gate = Promise.withResolvers<void>();
    const arrival = Promise.withResolvers<void>();
    const sub = subscription({
      handler: async (event) => {
        arrival.resolve();
        await gate.promise;
        handled.push(event.globalSeq);
        return ok(undefined);
      },
    });
    const draining = sub.poll();
    await arrival.promise;

    const resetting = sub.reset();
    gate.resolve();
    const outcome = await resetting;
    await draining;

    // An advance from the drain must not land behind the reset's save and falsify its Ok.
    expect(outcome.isOk()).toBe(true);
    expect(await checkpointOf()).toBe(0);
  });

  it('reset lifts a halt so a fixed poison event can be reattempted', async () => {
    feed.events = [seamEvent(1)];
    failures.set(1, [{ kind: 'Permanent', reason: 'InvalidPayload' }]);
    const sub = subscription();
    await sub.start();
    expect(sub.isHalted).toBe(true);

    await sub.reset();
    await sub.poll();

    expect(handled).toEqual([1]);
  });

  it('drops polls until every queued reset has finished, not just the first', async () => {
    // Two overlapping resets must queue. A boolean gate would be cleared by whichever landed
    // first, re-admitting the drain while the second's save was still in flight — and that second
    // reset would then report Ok over a position the drain had already moved past.
    const gates: { promise: Promise<void>; resolve: () => void }[] = [];
    const gatedCheckpoints = {
      load: (name: string) => checkpoints.load(name),
      save: (name: string, globalSeq: number) => {
        const gate = Promise.withResolvers<void>();
        gates.push(gate);
        return ResultAsync.fromSafePromise(gate.promise).andThen(() =>
          checkpoints.save(name, globalSeq),
        );
      },
    };
    const sub = subscription({ checkpoints: gatedCheckpoints });
    await sub.start(); // no events yet, so nothing is saved and the drain settles idle
    feed.events = [seamEvent(1), seamEvent(2)];

    const first = sub.reset(0);
    const second = sub.reset(0);
    await vi.waitFor(() => {
      expect(gates).toHaveLength(1); // queued: the second reset has not begun saving
    });
    gates[0]!.resolve();
    await first;

    await sub.poll(); // the second reset is still saving, and the drain is idle: this must not run
    expect(handled).toEqual([]);

    await vi.waitFor(() => {
      expect(gates).toHaveLength(2);
    });
    gates[1]!.resolve();
    await second;
  });

  it('a reset waiting on a drain that throws still answers with a value', async () => {
    // The reset barrier observes the drain only to know it has stopped touching the checkpoint.
    // A defect throw there belongs to the polling caller; it must never surface as a rejection of
    // the operator-facing reset, which is declared to answer with a Result.
    const arrival = Promise.withResolvers<void>();
    const gate = Promise.withResolvers<void>();
    const throwingFeed = {
      read: async () => {
        arrival.resolve();
        await gate.promise;
        throw new Error('feed adapter bug');
      },
    };
    const sub = subscription({ feed: throwingFeed });
    const draining = sub.poll();
    await arrival.promise;

    const resetting = sub.reset(0);
    gate.resolve();
    const outcome = await resetting;

    expect(outcome.isOk()).toBe(true);
    await expect(draining).rejects.toThrow('feed adapter bug');
  });

  it('a subscription halted by a checkpoint fault resumes on reset, without a restart', async () => {
    feed.events = [seamEvent(1), seamEvent(2)];
    checkpoints.failLoad = true;
    const sub = subscription();
    await sub.start();
    expect(handled).toEqual([]);
    // The wakeup and fallback wiring registers despite the halt — that is what makes the
    // documented recovery reachable without bouncing the process.
    expect(wakeListeners).toHaveLength(1);
    expect(intervals).toHaveLength(1);

    checkpoints.failLoad = false;
    const rearmed = await sub.reset(0);
    expect(rearmed.isOk()).toBe(true);
    intervals[0]!.fn();

    await vi.waitFor(() => {
      expect(handled).toEqual([1, 2]);
    });
  });

  it('stop detaches the wakeup listener and the fallback interval', async () => {
    const sub = subscription();
    await sub.start();
    expect(wakeListeners).toHaveLength(1);
    expect(intervals[0]!.stopped).toBe(false);

    sub.stop();

    expect(wakeListeners).toHaveLength(0);
    expect(intervals[0]!.stopped).toBe(true);
  });

  it('catches and logs an unexpected throw from a fire-and-forget poll, surviving the cycle', async () => {
    // A defective feed/handler that THROWS (rather than returning a modeled failure) is a bug; a
    // wakeup- or timer-driven poll must not let it escape as an unhandled process rejection — in
    // the composed monolith that rejection would terminate the one process serving the web UI and
    // both modules. It is caught at the boundary, logged, and the loop lives on.
    const lines: string[] = [];
    const logger = createLogger({
      level: 'error',
      destination: { write: (line: string) => void lines.push(line) },
    });
    let isBoom = false;
    const throwingFeed = {
      read: (from: number, limit: number) => {
        if (isBoom) throw new Error('feed adapter bug');
        return feed.read(from, limit);
      },
    };
    const sub = subscription({ feed: throwingFeed, logger });
    await sub.start(); // the initial (awaited) poll drains cleanly

    isBoom = true;
    for (const listener of wakeListeners) {
      listener(); // fires the fire-and-forget poll under the hood — the throw must be contained
    }
    await vi.waitFor(() => {
      expect(lines.join('')).toContain('seam subscription poll failed unexpectedly');
    });

    // The subscription survived: a later healthy poll still delivers.
    isBoom = false;
    feed.events = [seamEvent(1)];
    await sub.poll();
    expect(handled).toEqual([1]);
    sub.stop();
  });

  it('uses a real interval by default and stops it cleanly', async () => {
    vi.useFakeTimers();
    try {
      feed.events = [];
      const sub = subscription({ interval: undefined, pollIntervalMs: 50 });
      await sub.start();
      feed.events = [seamEvent(1)];

      await vi.advanceTimersByTimeAsync(60);
      expect(handled).toEqual([1]);

      sub.stop();
      feed.events.push(seamEvent(2));
      await vi.advanceTimersByTimeAsync(200);
      expect(handled).toEqual([1]);
    } finally {
      vi.useRealTimers();
    }
  });
});
