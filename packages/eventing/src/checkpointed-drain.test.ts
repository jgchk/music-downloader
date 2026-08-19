import { ResultAsync, err, errAsync, ok, okAsync } from 'neverthrow';
import type { Result } from 'neverthrow';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { CheckpointedDrain } from './checkpointed-drain.js';
import type {
  CheckpointedDrainDependencies,
  DrainBatch,
  DrainFailure,
  DrainFeed,
} from './checkpointed-drain.js';

/**
 * Let the event loop take one full turn. A `setImmediate` hop is a MACROTASK, so it runs only
 * after the microtask queue has fully drained — which is what makes the "has NOT resolved yet"
 * assertions below honest: any promise chain that was ready to settle has done so by the time this
 * resolves, so a still-pending flag means genuinely still pending.
 */
function settleEventLoopTurn(): Promise<void> {
  return new Promise((resolve) => setImmediate(resolve));
}

interface TestItem {
  readonly position: number;
}

/** An in-memory feed of published items, addressed by gapless position. */
class FakeFeed implements DrainFeed<TestItem> {
  public items: TestItem[] = [];
  public failure: DrainFailure | undefined;

  read(from: number, limit: number): Promise<Result<DrainBatch<TestItem>, DrainFailure>> {
    if (this.failure !== undefined) return Promise.resolve(err(this.failure));
    const pending = this.items.filter((item) => item.position > from).slice(0, limit);
    const scannedTo = pending.length > 0 ? pending.at(-1)!.position : from;
    return Promise.resolve(ok({ items: pending, scannedTo }));
  }

  positionOf(item: TestItem): number {
    return item.position;
  }
}

interface StoreFault {
  readonly kind: 'StoreFault';
  readonly message: string;
}

const storeFault = (message: string): StoreFault => ({ kind: 'StoreFault', message });

class FakeCheckpointStore {
  private readonly positions = new Map<string, number>();
  public failLoads = false;
  public failSaves = false;
  public rejectSaves = false;
  /** Saves of exactly these positions fail; everything else succeeds. */
  public failSavesAt = new Set<number>();
  /**
   * Park the NEXT save behind this (it clears itself), so a test can hold one open across a barrier.
   * Outranks the failure flags while set — a save gated here succeeds.
   */
  public gateNextSave: (() => Promise<void>) | undefined;

  load(consumer: string): ResultAsync<number, StoreFault> {
    if (this.failLoads) return errAsync(storeFault('load failed'));
    return okAsync(this.positions.get(consumer) ?? 0);
  }

  save(consumer: string, position: number): ResultAsync<void, StoreFault> {
    if (this.gateNextSave !== undefined) {
      const gate = this.gateNextSave();
      this.gateNextSave = undefined;
      const save = async (): Promise<void> => {
        await gate;
        this.positions.set(consumer, position);
      };
      return ResultAsync.fromSafePromise(save());
    }
    // `fromSafePromise` deliberately does NOT catch, so this models an adapter that rejects
    // instead of answering with a Result — a defect, not a modeled failure.
    if (this.rejectSaves) {
      return ResultAsync.fromSafePromise<void>(Promise.reject(new Error('store gone')));
    }
    if (this.failSaves || this.failSavesAt.has(position)) {
      return errAsync(storeFault('save failed'));
    }
    this.positions.set(consumer, position);
    return okAsync(undefined);
  }
}

interface LoggedLine {
  readonly level: 'warn' | 'error';
  readonly payload: Record<string, unknown>;
  readonly message: string;
}

function capturingLogger(): {
  logger: CheckpointedDrainDependencies<TestItem, StoreFault>['logger'];
  lines: LoggedLine[];
} {
  const lines: LoggedLine[] = [];
  return {
    lines,
    logger: {
      warn: (payload: object, message: string) =>
        void lines.push({ level: 'warn', payload: payload as Record<string, unknown>, message }),
      error: (payload: object, message: string) =>
        void lines.push({ level: 'error', payload: payload as Record<string, unknown>, message }),
    },
  };
}

let feed: FakeFeed;
let checkpoints: FakeCheckpointStore;
let stepped: number[];
let failures: Map<number, DrainFailure[]>;
let sleeps: number[];
let wakeListeners: (() => void)[];
let intervals: { fn: () => void; ms: number; stopped: boolean }[];
let logged: LoggedLine[];

beforeEach(() => {
  feed = new FakeFeed();
  checkpoints = new FakeCheckpointStore();
  stepped = [];
  failures = new Map();
  sleeps = [];
  wakeListeners = [];
  intervals = [];
  logged = [];
});

function item(position: number): TestItem {
  return { position };
}

function drain(
  overrides: Partial<CheckpointedDrainDependencies<TestItem, StoreFault>> = {},
): CheckpointedDrain<TestItem, StoreFault> {
  const capture = capturingLogger();
  logged = capture.lines;
  return new CheckpointedDrain<TestItem, StoreFault>({
    name: 'drain:test',
    feed,
    checkpoints,
    step: (subject) => {
      const queued = failures.get(subject.position);
      const next = queued?.shift();
      if (next !== undefined) return Promise.resolve(err(next));
      stepped.push(subject.position);
      return Promise.resolve(ok(undefined));
    },
    logger: capture.logger,
    mapDefect: (defect) => storeFault(defect.message),
    wakeups: {
      subscribe: (listener) => {
        wakeListeners.push(listener);
        return () => wakeListeners.splice(wakeListeners.indexOf(listener), 1);
      },
    },
    tuning: {
      retry: { attempts: 3, baseDelayMs: 100 },
      batchSize: 2,
      pollIntervalMs: 5000,
      sleep: (ms) => {
        sleeps.push(ms);
        return Promise.resolve();
      },
      interval: (function_, ms) => {
        const entry = { fn: function_, ms, stopped: false };
        intervals.push(entry);
        return () => {
          entry.stopped = true;
        };
      },
    },
    ...overrides,
  });
}

async function checkpointOf(name = 'drain:test'): Promise<number> {
  const loaded = await checkpoints.load(name);
  return loaded._unsafeUnwrap();
}

const transient = (reason = 'not yet'): DrainFailure => ({ kind: 'Transient', reason });
const permanent = (reason = 'poison'): DrainFailure => ({ kind: 'Permanent', reason });

function messages(): string[] {
  return logged.map((line) => line.message);
}

describe('CheckpointedDrain', () => {
  describe('delivery', () => {
    it('drains the backlog on start, in order, and checkpoints each processed item', async () => {
      feed.items = [item(1), item(2), item(3)];
      const subject = drain();

      await subject.start();

      expect(stepped).toEqual([1, 2, 3]);
      expect(await checkpointOf()).toBe(3);
      await subject.stop();
    });

    it('resumes strictly after its persisted checkpoint on restart', async () => {
      feed.items = [item(1), item(2), item(3)];
      await checkpoints.save('drain:test', 2);

      const subject = drain();
      await subject.start();

      expect(stepped).toEqual([3]);
      await subject.stop();
    });

    it('a crash between produce and consume redelivers: a fresh instance resumes from the checkpoint', async () => {
      feed.items = [item(1), item(2)];
      const first = drain();
      await first.start();
      await first.stop();
      expect(stepped).toEqual([1, 2]);

      feed.items.push(item(3));
      const second = drain();
      await second.start();

      expect(stepped).toEqual([1, 2, 3]); // no redelivery of 1 and 2, no gap at 3
      await second.stop();
    });

    it('drains in bounded batches, yielding between them', async () => {
      feed.items = [item(1), item(2), item(3), item(4)];
      const subject = drain();

      await subject.start();

      expect(stepped).toEqual([1, 2, 3, 4]);
      expect(sleeps.filter((ms) => ms === 0)).toEqual([0, 0]); // one yield per batch, no more
      await subject.stop();
    });

    it('keeps draining past a run of positions the producer never published', async () => {
      // A scanned window with NO deliverable items is progress, not the end of the feed. The window
      // has to be genuinely empty for this to mean anything: a fixture that returns the far item in
      // the same batch never produces the case, and a drain that treated an empty window as the end
      // would still pass it while walking a long gap one poll interval at a time.
      const windowed: DrainFeed<TestItem> = {
        read: (from) => {
          if (from < 1) return Promise.resolve(ok({ items: [item(1)], scannedTo: 1 }));
          if (from < 40) return Promise.resolve(ok({ items: [], scannedTo: from + 20 })); // the gap
          if (from < 50) return Promise.resolve(ok({ items: [item(50)], scannedTo: 50 }));
          return Promise.resolve(ok({ items: [], scannedTo: from }));
        },
        positionOf: (subject) => subject.position,
      };
      const subject = drain({ feed: windowed });

      await subject.start();

      expect(stepped).toEqual([1, 50]); // it crossed the empty window within one cycle
      expect(await checkpointOf()).toBe(50);
      await subject.stop();
    });

    it('advances the checkpoint past batches that contain no published items', async () => {
      feed.items = [];
      const emptyButScanning: DrainFeed<TestItem> = {
        read: (from) => Promise.resolve(ok({ items: [], scannedTo: Math.max(from, 10) })),
        positionOf: (subject) => subject.position,
      };
      const subject = drain({ feed: emptyButScanning });

      await subject.start();

      expect(await checkpointOf()).toBe(10);
      await subject.stop();
    });
  });

  describe('transient failure holds, never loses', () => {
    it('retries a transient failure with backoff, then holds the checkpoint for the next cycle', async () => {
      feed.items = [item(1)];
      failures.set(1, [transient(), transient(), transient()]);
      const subject = drain();

      await subject.start();

      expect(stepped).toEqual([]);
      expect(await checkpointOf()).toBe(0); // held, not advanced past
      expect(sleeps).toEqual([100, 200]); // base * 2^(n-1), between attempts only
      await subject.stop();
    });

    it('spends the whole retry budget: a fault that clears on the last attempt still delivers', async () => {
      feed.items = [item(1)];
      failures.set(1, [transient(), transient()]); // clears on attempt 3 of 3
      const subject = drain();

      await subject.start();

      expect(stepped).toEqual([1]);
      expect(await checkpointOf()).toBe(1);
      await subject.stop();
    });

    it('names the failure in the standing-hold log, so a wedged seam says why', async () => {
      feed.items = [item(1)];
      failures.set(1, [
        transient('the source is unavailable'),
        transient('the source is unavailable'),
        transient('the source is unavailable'),
      ]);
      const subject = drain();

      await subject.start();

      const held = logged.find((line) =>
        line.message.includes('exhausted cycle retries; holding checkpoint for redelivery'),
      );
      expect(held).toBeDefined();
      expect(held?.payload).toMatchObject({ err: { reason: 'the source is unavailable' } });
      await subject.stop();
    });

    it('redelivers a held item on the next cycle once the fault clears', async () => {
      feed.items = [item(1)];
      failures.set(1, [transient(), transient(), transient()]);
      const subject = drain();
      await subject.start();
      expect(stepped).toEqual([]);

      await subject.poll(); // the fault has cleared; the held position is re-read

      expect(stepped).toEqual([1]);
      expect(await checkpointOf()).toBe(1);
      await subject.stop();
    });

    it("carries the classifier's cause into the log, so a halted seam says what broke", async () => {
      // `kind` and `reason` only restate what readiness already reports. The field that names the
      // actual defect — which event type failed to render — lives in the consumer's own error, and
      // a classifier that dropped it would leave an operator with a stall and no fix.
      feed.failure = {
        kind: 'Permanent',
        reason: 'RenderError',
        cause: { kind: 'RenderError', eventType: 'WidgetRendered', message: 'schema refused it' },
      };
      const subject = drain();

      await subject.start();

      const halted = logged.find((line) => line.message.includes('render defect'));
      expect(halted?.payload).toMatchObject({
        err: { cause: { eventType: 'WidgetRendered', message: 'schema refused it' } },
      });
      await subject.stop();
    });

    it('a feed read failure holds the checkpoint and recovers on a later cycle', async () => {
      feed.items = [item(1)];
      feed.failure = transient('store busy');
      const subject = drain();
      await subject.start();
      expect(stepped).toEqual([]);
      expect(subject.isHalted).toBe(false); // transient: held, not halted

      feed.failure = undefined;
      await subject.poll();

      expect(stepped).toEqual([1]);
      await subject.stop();
    });

    it('a checkpoint save failure holds delivery rather than losing it', async () => {
      feed.items = [item(1), item(2)];
      checkpoints.failSaves = true;
      const subject = drain();

      await subject.start();

      expect(stepped).toEqual([1]); // the first was handled, its checkpoint could not be recorded
      expect(await checkpointOf()).toBe(0);
      expect(subject.isHalted).toBe(false); // held, not poisoned — the next cycle retries
      expect(messages()).toContain('checkpoint save failed; holding for redelivery');
      await subject.stop();
    });

    it('redelivers a held item once the store recovers — at-least-once means duplicates happen', async () => {
      feed.items = [item(1), item(2)];
      checkpoints.failSaves = true;
      const subject = drain();
      await subject.start();
      expect(stepped).toEqual([1]);

      checkpoints.failSaves = false;
      await subject.poll();

      expect(stepped).toEqual([1, 1, 2]); // item 1 handled twice: the consumer must be idempotent
      expect(await checkpointOf()).toBe(2);
      await subject.stop();
    });

    it('checkpoints the position it recorded, never the one it merely scanned past', async () => {
      // A selective fault: the save for the delivered item succeeds, the trailing scan's does not.
      feed.items = [item(1), item(6)];
      checkpoints.failSavesAt = new Set([6]);
      const subject = drain({ tuning: { batchSize: 1 } });

      await subject.start();

      // Both were handed to the step; only the one whose save landed is durable, so the next
      // cycle redelivers the second — the point of never checkpointing ahead of a commit.
      expect(stepped).toEqual([1, 6]);
      expect(await checkpointOf()).toBe(1);
      await subject.stop();
    });

    it('ends the cycle when the scanned-past position itself cannot be checkpointed', async () => {
      // The trailing scan advance is the only writer for a gap; if it fails the cycle must stop
      // rather than read on past a position it never durably recorded.
      const scanning: DrainFeed<TestItem> = {
        read: (from) => Promise.resolve(ok({ items: [], scannedTo: from + 10 })),
        positionOf: (subject) => subject.position,
      };
      checkpoints.failSaves = true;
      const subject = drain({ feed: scanning });

      await subject.start();

      expect(await checkpointOf()).toBe(0);
      expect(messages()).toContain('checkpoint save failed; holding for redelivery');
      await subject.stop();
    });
  });

  describe('a feed whose positions do not ascend is a producer defect', () => {
    it('halts rather than re-reading a window it has already checkpointed', async () => {
      // The cursor is the drain's only guarantee that work is not redelivered forever. A feed that
      // answers a position at or behind it would drive the durable checkpoint DOWN, and the
      // no-progress exit cannot catch that, because the cursor did move.
      const stuck: DrainFeed<TestItem> = {
        read: (from, limit) => feed.read(from, limit),
        positionOf: () => 0,
      };
      feed.items = [item(1), item(2)];
      const subject = drain({ feed: stuck });

      await subject.start();

      expect(subject.isHalted).toBe(true);
      expect(await checkpointOf()).toBe(0);
      expect(messages()).toContain(
        'feed reported a position at or behind the checkpoint; drain halted (positions must ascend)',
      );
      await subject.stop();
    });
  });

  describe('halt-only poison policy', () => {
    it('a poison item stops the drain without advancing', async () => {
      feed.items = [item(1), item(2)];
      failures.set(1, [permanent('schema drift')]);
      const subject = drain();

      await subject.start();

      expect(subject.isHalted).toBe(true);
      expect(stepped).toEqual([]);
      expect(await checkpointOf()).toBe(0); // held: order over progress
      expect(messages()).toContain(
        'poison event; subscription halted, checkpoint held (order over progress)',
      );
      await subject.stop();
    });

    it("carries the step classifier's cause into the halt log", async () => {
      // The feed path is pinned above. This is the other producer of a Permanent classification, and
      // the one a consumer's own schema failure travels — so it is the line that has to name which
      // field refused, not merely that something did.
      feed.items = [item(1)];
      failures.set(1, [
        {
          kind: 'Permanent',
          reason: 'InvalidPayload',
          cause: { field: 'verdict', issue: 'required' },
        },
      ]);
      const subject = drain();

      await subject.start();

      const halted = logged.find((line) => line.message.includes('poison event'));
      expect(halted?.payload).toMatchObject({
        err: { reason: 'InvalidPayload', cause: { field: 'verdict' } },
      });
      await subject.stop();
    });

    it('does not retry a permanent failure — deterministic failures gain nothing from repetition', async () => {
      feed.items = [item(1)];
      failures.set(1, [permanent(), permanent(), permanent()]);
      const subject = drain();

      await subject.start();

      expect(sleeps.filter((ms) => ms > 0)).toEqual([]); // straight to the policy, no backoff
      await subject.stop();
    });

    it('halts on a permanent feed defect rather than retrying forever', async () => {
      feed.items = [item(1)];
      feed.failure = permanent('render defect');
      const subject = drain();

      await subject.start();

      expect(subject.isHalted).toBe(true);
      expect(await checkpointOf()).toBe(0);
      // Exactly one line, and it names the defect permanent. Falling through to the transient
      // "holding checkpoint" line would tell an operator to wait for a retry that never comes.
      expect(messages()).toEqual([
        'seam feed render defect (permanent); subscription halted, checkpoint held',
      ]);
      await subject.stop();
    });

    it('halts on a faulted checkpoint read instead of replaying the whole feed from zero', async () => {
      // A faulted read knows nothing; collapsing it into "fresh consumer at 0" would assert a
      // durable fact and redeliver the producer's entire history.
      feed.items = [item(1), item(2)];
      checkpoints.failLoads = true;
      const subject = drain();

      await subject.start();

      expect(subject.isHalted).toBe(true);
      expect(stepped).toEqual([]);
      await subject.stop();
    });

    it('drains are isolated: one halting does not stop another', async () => {
      feed.items = [item(1)];
      failures.set(1, [permanent()]);
      const halting = drain();
      await halting.start();
      expect(halting.isHalted).toBe(true);

      failures.clear();
      const healthy = drain({ name: 'drain:other' });
      await healthy.start();

      expect(stepped).toEqual([1]);
      await halting.stop();
      await healthy.stop();
    });

    it('a halted drain ignores further polls', async () => {
      feed.items = [item(1)];
      failures.set(1, [permanent()]);
      const subject = drain();
      await subject.start();

      failures.clear();
      await subject.poll();

      expect(stepped).toEqual([]); // still halted; recovery is a restart or a reset
      await subject.stop();
    });
  });

  describe('wakeups and the fallback poll', () => {
    it('a wakeup is only a hint — the fallback poll alone still delivers', async () => {
      const subject = drain({ wakeups: undefined });
      await subject.start();
      feed.items = [item(1)];

      for (const entry of intervals) entry.fn();
      await vi.waitFor(() => {
        expect(stepped).toEqual([1]);
      });
      await subject.stop();
    });

    it('a wakeup delivers promptly without waiting for the interval', async () => {
      const subject = drain();
      await subject.start();
      feed.items = [item(1)];

      for (const listener of wakeListeners) listener();
      await vi.waitFor(() => {
        expect(stepped).toEqual([1]);
      });
      await subject.stop();
    });

    it('a wakeup landing mid-cycle earns another pass instead of waiting for the fallback poll', async () => {
      const gate = Promise.withResolvers<void>();
      let isGated = true;
      const gatedFeed: DrainFeed<TestItem> = {
        read: async (from, limit) => {
          if (isGated) {
            isGated = false;
            await gate.promise;
          }
          return feed.read(from, limit);
        },
        positionOf: (subject) => subject.position,
      };
      feed.items = [item(1)];
      const subject = drain({ feed: gatedFeed });

      const polling = subject.poll();
      await settleEventLoopTurn();
      feed.items.push(item(2)); // arrives while the first cycle is parked
      for (const listener of wakeListeners) listener();
      gate.resolve();
      await polling;

      expect(stepped).toEqual([1, 2]); // the coalesced wakeup earned the second pass
      await subject.stop();
    });

    it('concurrent polls coalesce instead of interleaving', async () => {
      feed.items = [item(1), item(2), item(3), item(4)];
      const subject = drain();

      await Promise.all([subject.poll(), subject.poll(), subject.poll()]);

      expect(stepped).toEqual([1, 2, 3, 4]); // each item delivered exactly once, in order
      await subject.stop();
    });

    it('catches and logs an unexpected throw from a fire-and-forget poll, surviving the cycle', async () => {
      // A defective feed or step that THROWS rather than returning a modeled failure is a bug; a
      // wakeup-driven poll must not let it escape as an unhandled process rejection.
      let isBoom = false;
      const throwingFeed: DrainFeed<TestItem> = {
        read: (from, limit) => {
          if (isBoom) throw new Error('feed adapter bug');
          return feed.read(from, limit);
        },
        positionOf: (subject) => subject.position,
      };
      const subject = drain({ feed: throwingFeed });
      await subject.start();

      isBoom = true;
      for (const listener of wakeListeners) listener();
      await vi.waitFor(() => {
        expect(messages()).toContain('seam subscription poll failed unexpectedly');
      });

      isBoom = false;
      feed.items = [item(1)];
      await subject.poll();
      expect(stepped).toEqual([1]); // the loop lived on
      await subject.stop();
    });

    it('lets a defect from an awaited poll reach its caller', async () => {
      // The fire-and-forget path contains defects; the awaited path deliberately does not, so a
      // boot-time drain failure fails the boot rather than being swallowed into a log line.
      const throwingFeed: DrainFeed<TestItem> = {
        read: () => {
          throw new Error('feed adapter bug');
        },
        positionOf: (subject) => subject.position,
      };
      const subject = drain({ feed: throwingFeed });

      await expect(subject.poll()).rejects.toThrow('feed adapter bug');
    });
  });

  describe('tuning', () => {
    it('uses a real interval by default and stops it cleanly', async () => {
      vi.useFakeTimers();
      try {
        const subject = drain({ tuning: { pollIntervalMs: 50, batchSize: 2 } });
        await subject.start();
        feed.items = [item(1)];

        await vi.advanceTimersByTimeAsync(60);
        expect(stepped).toEqual([1]);

        await subject.stop();
        feed.items.push(item(2));
        await vi.advanceTimersByTimeAsync(200);
        expect(stepped).toEqual([1]); // the timer really was detached
      } finally {
        vi.useRealTimers();
      }
    });

    it('applies its own defaults when a caller supplies no tuning at all', async () => {
      // Production supplies none: the constants that have never varied live here, not at each
      // call site. A default that silently failed to apply would show up as a drain that never
      // batches or never retries.
      vi.useFakeTimers();
      try {
        feed.items = [item(1)];
        failures.set(1, [transient(), transient()]);
        const subject = drain({ tuning: undefined });

        const started = subject.start();
        await vi.advanceTimersByTimeAsync(1000); // default backoff is real time: 250ms, then 500ms
        await started;

        expect(stepped).toEqual([1]); // three default attempts were available, the third succeeded
        await subject.stop();
      } finally {
        vi.useRealTimers();
      }
    });
  });

  describe('reset', () => {
    it('replays the feed from the start and idempotent handling converges', async () => {
      feed.items = [item(1), item(2)];
      const subject = drain();
      await subject.start();
      expect(stepped).toEqual([1, 2]);

      const reset = await subject.reset();
      expect(reset.isOk()).toBe(true);
      await subject.poll();

      expect(stepped).toEqual([1, 2, 1, 2]);
      await subject.stop();
    });

    it('reports a checkpoint-save failure instead of claiming the replay was recorded', async () => {
      const subject = drain();
      await subject.start();
      checkpoints.failSaves = true;

      const reset = await subject.reset(0);

      // The store's OWN modeled error, unwrapped — distinct from the DrainDefect channel a
      // rejecting adapter takes. A mutant collapsing the two would be invisible without this.
      expect(reset._unsafeUnwrapErr()).toEqual(storeFault('save failed'));
      expect(messages()).toContain('checkpoint reset failed; replay not armed');
      await subject.stop();
    });

    it('leaves a halted drain halted when the reset it was told to arm did not land', async () => {
      // The dangerous shape: report the replay as unarmed AND resume delivering anyway, from the
      // old position. The halt must outlive a reset that failed to persist.
      feed.items = [item(1)];
      failures.set(1, [permanent()]);
      const subject = drain();
      await subject.start();
      expect(subject.isHalted).toBe(true);

      checkpoints.failSaves = true;
      const reset = await subject.reset(0);

      expect(reset.isErr()).toBe(true);
      expect(subject.isHalted).toBe(true);
      await subject.stop();
    });

    it('a failed reset leaves the in-memory cursor on the durable checkpoint, not the requested one', async () => {
      feed.items = [item(1), item(2)];
      const subject = drain();
      await subject.start();
      expect(await checkpointOf()).toBe(2);

      checkpoints.failSaves = true;
      await subject.reset(0);
      checkpoints.failSaves = false;
      feed.items.push(item(3));
      await subject.poll();

      expect(stepped).toEqual([1, 2, 3]); // resumed from 2, not replayed from 0
      await subject.stop();
    });

    it('waits out an in-flight drain, so its Ok arm is the durable truth', async () => {
      const gate = Promise.withResolvers<void>();
      let isGated = true;
      const gatedFeed: DrainFeed<TestItem> = {
        read: async (from, limit) => {
          if (isGated) {
            isGated = false;
            await gate.promise;
          }
          return feed.read(from, limit);
        },
        positionOf: (subject) => subject.position,
      };
      feed.items = [item(1)];
      const subject = drain({ feed: gatedFeed });

      const polling = subject.poll();
      await settleEventLoopTurn();
      const resetting = subject.reset(0);
      let hasReset = false;
      void resetting.then(() => {
        hasReset = true;
      });
      await settleEventLoopTurn();
      expect(hasReset).toBe(false); // the drain still owns the checkpoint

      gate.resolve();
      await polling;
      const reset = await resetting;

      expect(reset.isOk()).toBe(true);
      expect(await checkpointOf()).toBe(0); // the reset landed last, so 0 is the durable truth
      await subject.stop();
    });

    it('drops polls until every queued reset has finished, not just the first', async () => {
      feed.items = [item(1)];
      const subject = drain();
      await subject.start();
      stepped.length = 0;

      const first = subject.reset(0);
      const second = subject.reset(0);
      await subject.poll(); // must be dropped: resets are still in flight
      expect(stepped).toEqual([]);

      await Promise.all([first, second]);
      await subject.poll();

      expect(stepped).toEqual([1]);
      await subject.stop();
    });

    it('lifts a halt so a fixed poison item can be reattempted', async () => {
      feed.items = [item(1)];
      failures.set(1, [permanent()]);
      const subject = drain();
      await subject.start();
      expect(subject.isHalted).toBe(true);

      failures.clear();
      const reset = await subject.reset(0);
      expect(reset.isOk()).toBe(true);
      expect(subject.isHalted).toBe(false);
      await subject.poll();

      expect(stepped).toEqual([1]);
      await subject.stop();
    });

    it('resumes a drain halted by a checkpoint fault, without a restart', async () => {
      feed.items = [item(1)];
      checkpoints.failLoads = true;
      const subject = drain();
      await subject.start();
      expect(subject.isHalted).toBe(true);

      checkpoints.failLoads = false;
      await subject.reset(0);
      await subject.poll();

      expect(stepped).toEqual([1]);
      await subject.stop();
    });

    it('answers with a value even when the drain it waits on throws', async () => {
      const throwingFeed: DrainFeed<TestItem> = {
        read: () => {
          throw new Error('feed adapter bug');
        },
        positionOf: (subject) => subject.position,
      };
      const subject = drain({ feed: throwingFeed });
      const polling = subject.poll();

      const reset = await subject.reset(0);

      expect(reset.isOk()).toBe(true);
      await expect(polling).rejects.toThrow('feed adapter bug');
    });

    it('reports a rejecting checkpoint store as a modeled failure, not a rejection', async () => {
      // The store is declared to answer with a Result. An adapter that rejects instead is a defect,
      // but it must still reach the caller through the reset's declared error channel — and say so
      // in its own words rather than borrowing the store's, which never spoke.
      const subject = drain();
      checkpoints.rejectSaves = true;

      const reset = await subject.reset(0);

      // Translated, not leaked: the caller sees ITS OWN error type, so a consumer narrowing on its
      // own union never meets a variant its module never declared.
      expect(reset._unsafeUnwrapErr()).toEqual(storeFault('checkpoint reset failed unexpectedly'));
    });
  });

  describe('stop', () => {
    it('waits out an in-flight reset, the other writer to the checkpoint', async () => {
      // `stop()` resolving is the caller's signal to close the store handle. A reset saves the
      // checkpoint too, and with no drain cycle running there is no in-flight cycle to await — so a
      // barrier that watched only the drain would resolve straight into a closed-handle write.
      const gate = Promise.withResolvers<void>();
      const slowSaves = new FakeCheckpointStore();
      slowSaves.gateNextSave = () => gate.promise;
      const subject = drain({ checkpoints: slowSaves });

      const resetting = subject.reset(0);
      await settleEventLoopTurn();
      const stopping = subject.stop();
      let hasStopped = false;
      void stopping.then(() => {
        hasStopped = true;
      });
      await settleEventLoopTurn();
      expect(hasStopped).toBe(false); // the reset still owns the checkpoint

      gate.resolve();
      await stopping;
      await resetting;
    });

    it('detaches the wakeup listener and the fallback interval', async () => {
      const subject = drain();
      await subject.start();
      expect(wakeListeners).toHaveLength(1);

      await subject.stop();

      expect(wakeListeners).toHaveLength(0);
      expect(intervals.every((entry) => entry.stopped)).toBe(true);
    });

    it('waits out an in-flight drain instead of resolving while it still writes', async () => {
      // The runtime closes the event-store handle the moment stop() resolves. Detaching the timer
      // only stops the NEXT cycle; a cycle already draining would go on reading the feed and saving
      // checkpoints against a closed database.
      const gate = Promise.withResolvers<void>();
      feed.items = [item(1)];
      const gatedFeed: DrainFeed<TestItem> = {
        read: async (from, limit) => {
          await gate.promise;
          return feed.read(from, limit);
        },
        positionOf: (subject) => subject.position,
      };
      const subject = drain({ feed: gatedFeed });

      const polling = subject.poll();
      await settleEventLoopTurn();
      expect(stepped).toEqual([]);

      const stopping = subject.stop();
      let hasStopped = false;
      void stopping.then(() => {
        hasStopped = true;
      });
      await settleEventLoopTurn();
      expect(hasStopped).toBe(false); // the drain still holds the store

      gate.resolve();
      await stopping;

      expect(stepped).toEqual([1]);
      expect(await checkpointOf()).toBe(1);
      await polling;
    });
  });
});
