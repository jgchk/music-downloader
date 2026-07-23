import { errAsync, okAsync } from 'neverthrow';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  DIRECTORY,
  POLICY,
  candidate,
  requested,
} from '../../domain/import/__fixtures__/import-fixtures.js';
import { asDistance } from '../../domain/shared/__fixtures__/distance.js';
import type { ImportEvent } from '../../domain/import/events.js';
import { infraError } from '../ports/errors.js';
import {
  FakeCheckpointStore,
  FakeDeadLetterStore,
  FakeEventBus,
  FakeEventStore,
  FakeParkedEffectStore,
  fixedClock,
  silentLogger,
} from '../__fixtures__/fakes.js';
import { StalledReadModel } from '../projections/read-models.js';
import { applyCommand } from './command-handler.js';
import type { EffectPorts } from './interpreter.js';
import { interpretEffect } from './interpreter.js';
import { REACTOR_CONSUMER, Reactor } from './reactor.js';
import type { EffectInterpreter } from './reactor.js';

let store: FakeEventStore;
let checkpoints: FakeCheckpointStore;
let bus: FakeEventBus;
let deadLetters: FakeDeadLetterStore;
let parked: FakeParkedEffectStore;
let stalled: StalledReadModel;

beforeEach(() => {
  store = new FakeEventStore();
  checkpoints = new FakeCheckpointStore();
  bus = new FakeEventBus();
  deadLetters = new FakeDeadLetterStore();
  parked = new FakeParkedEffectStore();
  stalled = new StalledReadModel();
  store.bus = bus;
});

function realInterpret(ports: EffectPorts): EffectInterpreter {
  const deps = { store, clock: fixedClock(), ports };
  return (importId, effect) => interpretEffect(deps, importId, effect);
}

function reactor(
  interpret: EffectInterpreter,
  overrides: {
    interval?: (fn: () => void, ms: number) => () => void;
    retryBudget?: number;
  } = {},
): Reactor {
  return new Reactor({
    store,
    checkpoints,
    bus,
    deadLetters,
    parked,
    stalled,
    clock: fixedClock(),
    logger: silentLogger(),
    interpret,
    // Tests drive drains explicitly; the default real interval is covered by its own test below.
    interval: overrides.interval ?? (() => () => {}),
    retryBudget: overrides.retryBudget,
  });
}

/** Seed history without publishing: detach the bus for the append, as a pre-start backlog. */
async function seed(history: readonly ImportEvent[]): Promise<void> {
  store.bus = undefined;
  await store.append('imp-1', 0, history, { importId: 'imp-1', occurredAt: 't' });
  store.bus = bus;
}

describe('Reactor', () => {
  it('drains the backlog on start and checkpoints the last processed event', async () => {
    await seed([requested()]);
    const interpret = vi.fn(() => okAsync([]));
    await reactor(interpret).start();

    expect(interpret).toHaveBeenCalledWith('imp-1', expect.objectContaining({ type: 'Propose' }));
    expect(checkpoints.peek(REACTOR_CONSUMER)).toBe(1);
  });

  it('resumes past the checkpoint without re-firing already-dispatched effects', async () => {
    await seed([requested()]);
    await checkpoints.save(REACTOR_CONSUMER, 1);
    const interpret = vi.fn(() => okAsync([]));
    await reactor(interpret).start();

    expect(interpret).not.toHaveBeenCalled();
  });

  it('drives a submission through propose, auto-apply, and applied end to end', async () => {
    const ports: EffectPorts = {
      tagger: {
        propose: vi.fn(() =>
          okAsync({
            kind: 'proposal' as const,
            candidates: [candidate({ distance: asDistance(0.01) })],
            duplicates: [],
          }),
        ),
        apply: vi.fn(() =>
          okAsync({ kind: 'applied' as const, location: '/library/Artist/Album', failures: [] }),
        ),
        validate: vi.fn(),
      },
      intake: { deleteRelease: vi.fn() },
    };
    const r = reactor(realInterpret(ports));
    await r.start();

    await applyCommand({ store, clock: fixedClock() }, 'imp-1', {
      type: 'SubmitImport',
      directory: DIRECTORY,
      policy: POLICY,
    });
    await vi.waitFor(() => {
      expect(store.all().map((entry) => entry.type)).toEqual([
        'ImportRequested',
        'CandidatesProposed',
        'AutoApplySelected',
        'ImportApplied',
      ]);
    });
    expect(ports.tagger.apply).toHaveBeenCalledWith(DIRECTORY, {
      kind: 'candidate',
      ref: candidate().ref,
    });
    r.stop();
  });

  it('tolerates stop() before start()', () => {
    expect(() => reactor(vi.fn(() => okAsync([]))).stop()).not.toThrow();
  });

  it('deduplicates an already-processed event under at-least-once redelivery', async () => {
    await seed([requested()]);
    const interpret = vi.fn(() => okAsync([]));
    const r = reactor(interpret);
    await r.start();
    expect(interpret).toHaveBeenCalledTimes(1);

    await r.process(store.all()[0]!); // redelivery of the already-checkpointed event
    expect(interpret).toHaveBeenCalledTimes(1);
  });

  it('stops following live events after stop()', async () => {
    const interpret = vi.fn(() => okAsync([]));
    const r = reactor(interpret);
    await r.start();
    expect(bus.subscriberCount()).toBe(1);
    r.stop();
    expect(bus.subscriberCount()).toBe(0);
  });

  it('leaves the checkpoint unadvanced on a retryable effect failure', async () => {
    await seed([requested()]);
    const interpret = vi.fn(() => errAsync(infraError('bridge.propose', 'spawn failed')));
    await reactor(interpret).start();

    expect(checkpoints.peek(REACTOR_CONSUMER)).toBeUndefined();
  });

  it('advances past a follow-on the domain rejected as stale/illegal, never parking or dead-lettering', async () => {
    await seed([requested()]);
    const interpret = vi.fn(() => errAsync({ kind: 'NoOpenReview' as const }));
    await reactor(interpret).start();

    expect(checkpoints.peek(REACTOR_CONSUMER)).toBe(1);
    // A domain rejection is settled, not retryable: it must not touch the durable budget stores.
    expect(parked.count()).toBe(0);
    expect(deadLetters.letters).toHaveLength(0);
  });

  it('treats a concurrency conflict as retryable', async () => {
    await seed([requested()]);
    const interpret = vi.fn(() =>
      errAsync({ kind: 'ConcurrencyConflict' as const, streamId: 'imp-1', expectedVersion: 0 }),
    );
    await reactor(interpret).start();

    expect(checkpoints.peek(REACTOR_CONSUMER)).toBeUndefined();
  });

  it('skips reacting when the stream read fails, leaving the checkpoint put', async () => {
    await seed([requested()]);
    store.failReads = true;
    const interpret = vi.fn(() => okAsync([]));
    await reactor(interpret).start();

    expect(interpret).not.toHaveBeenCalled();
    expect(checkpoints.peek(REACTOR_CONSUMER)).toBeUndefined();
  });

  it('logs and carries on when the backlog read fails', async () => {
    store.failReadAll = true;
    const interpret = vi.fn(() => okAsync([]));
    const r = reactor(interpret);
    await r.start();

    expect(bus.subscriberCount()).toBe(1); // still follows live events
    r.stop();
  });

  it('processes follow-ons appended during the startup drain (no wakeup gap)', async () => {
    // A backlogged ImportRequested whose re-fired Propose effect appends its own follow-ons while
    // the drain is mid-pass — the exact restart shape: the appended events must not fall into the
    // gap between the one-shot backlog snapshot and the live subscription.
    await seed([requested()]);
    const apply = vi.fn((_importId: string, _effect: unknown) => okAsync([]));
    const interpret: EffectInterpreter = (importId, effect) => {
      if (effect.type === 'Propose') {
        return store
          .append(
            importId,
            1,
            [
              {
                type: 'CandidatesProposed',
                candidates: [candidate({ distance: asDistance(0.01) })],
                duplicates: [],
              },
              { type: 'AutoApplySelected', ref: candidate().ref, distance: asDistance(0.01) },
            ],
            { importId, occurredAt: 't' },
          )
          .map(() => []);
      }
      return apply(importId, effect);
    };
    const r = reactor(interpret);
    await r.start();

    await vi.waitFor(() => {
      expect(apply).toHaveBeenCalledWith('imp-1', expect.objectContaining({ type: 'Apply' }));
      expect(checkpoints.peek(REACTOR_CONSUMER)).toBe(3);
    });
    r.stop();
  });

  it('retries a transiently failed effect on the fallback poll, with no new event', async () => {
    await seed([requested()]);
    const ticks: (() => void)[] = [];
    const interpret = vi
      .fn<EffectInterpreter>()
      .mockReturnValueOnce(errAsync(infraError('bridge.propose', 'spawn failed')))
      .mockReturnValue(okAsync([]));
    const r = reactor(interpret, {
      interval: (fn) => {
        ticks.push(fn);
        return () => {};
      },
    });
    await r.start();
    expect(checkpoints.peek(REACTOR_CONSUMER)).toBeUndefined();

    ticks[0]!(); // the fallback poll fires — nothing else does
    await vi.waitFor(() => {
      expect(checkpoints.peek(REACTOR_CONSUMER)).toBe(1);
    });
    r.stop();
  });

  it('polls on a real timer by default, and stop() clears it', async () => {
    vi.useFakeTimers();
    try {
      const interpret = vi.fn(() => okAsync([]));
      const r = new Reactor({
        store,
        checkpoints,
        bus,
        deadLetters,
        parked,
        stalled,
        clock: fixedClock(),
        logger: silentLogger(),
        interpret,
      });
      await r.start();

      await seed([requested()]); // appended with the bus detached: only the poll can find it
      await vi.advanceTimersByTimeAsync(5_000);
      expect(interpret).toHaveBeenCalledWith('imp-1', expect.objectContaining({ type: 'Propose' }));

      r.stop();
      await seed([requested()]);
      await vi.advanceTimersByTimeAsync(60_000);
      expect(interpret).toHaveBeenCalledTimes(1);
    } finally {
      vi.useRealTimers();
    }
  });

  it('coalesces wakeups that arrive while a drain is running', async () => {
    await seed([requested()]);
    let release: (() => void) | undefined;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    const interpret = vi.fn(() => okAsync([]));
    const slowFirst = vi.fn<EffectInterpreter>((importId, effect) => {
      void importId;
      void effect;
      if (slowFirst.mock.calls.length === 1) {
        return okAsync([]).andThen(() => okAsync(gate).map(() => []));
      }
      return interpret();
    });
    const r = reactor(slowFirst);
    const started = r.start();
    // Two wakeups land while the first drain is blocked mid-effect; they coalesce into one more
    // pass rather than interleaving or being lost.
    await r.drain();
    await r.drain();
    release?.();
    await started;
    await vi.waitFor(() => {
      expect(checkpoints.peek(REACTOR_CONSUMER)).toBe(1);
    });
    r.stop();
  });

  it('checkpoints record-only events without firing effects', async () => {
    await seed([
      requested(),
      { type: 'CandidatesProposed', candidates: [], duplicates: [] },
      { type: 'ReviewRequired', cause: { kind: 'no-match' } },
    ]);
    const interpret = vi.fn(() => okAsync([]));
    await reactor(interpret).start();

    // Propose fires once (for ImportRequested); the record-only events just advance the checkpoint.
    expect(interpret).toHaveBeenCalledTimes(1);
    expect(checkpoints.peek(REACTOR_CONSUMER)).toBe(3);
  });

  it('holds the position for redelivery when the durable checkpoint save fails', async () => {
    await seed([requested()]);
    const interpret = vi.fn(() => okAsync([]));
    checkpoints.failSaves = true;
    const r = reactor(interpret);
    await r.start();

    // The effect fired but its checkpoint write failed: the position is NOT advanced in memory, so
    // the event redelivers instead of being silently dropped.
    expect(interpret).toHaveBeenCalledTimes(1);
    expect(checkpoints.peek(REACTOR_CONSUMER)).toBeUndefined();

    checkpoints.failSaves = false;
    await r.drain();
    expect(interpret).toHaveBeenCalledTimes(2); // held event re-dispatched on the next drain
    expect(checkpoints.peek(REACTOR_CONSUMER)).toBe(1);
  });

  it('dead-letters an effect that exhausts its retry budget and advances past it', async () => {
    await seed([requested()]);
    const interpret = vi.fn(() => errAsync(infraError('bridge.propose', 'beets always fails')));
    const r = reactor(interpret, { retryBudget: 2 });

    await r.start(); // attempt 1 (< budget): held, nothing dead-lettered
    expect(checkpoints.peek(REACTOR_CONSUMER)).toBeUndefined();
    expect(deadLetters.letters).toHaveLength(0);

    await r.drain(); // attempt 2 hits the budget: dead-lettered and advanced past
    expect(deadLetters.letters).toHaveLength(1);
    const [letter] = deadLetters.letters;
    expect(letter).toMatchObject({ subscription: REACTOR_CONSUMER, globalSeq: 1 });
    expect(letter?.error).toContain('bridge.propose');
    expect(checkpoints.peek(REACTOR_CONSUMER)).toBe(1); // the queue is not wedged behind the poison
  });

  it('dead-letters a concurrency conflict that exhausts its budget, rendering its detail', async () => {
    await seed([requested()]);
    const interpret = vi.fn(() =>
      errAsync({ kind: 'ConcurrencyConflict' as const, streamId: 'imp-1', expectedVersion: 0 }),
    );
    const r = reactor(interpret, { retryBudget: 1 });

    await r.start();

    expect(deadLetters.letters).toHaveLength(1);
    expect(deadLetters.letters[0]?.error).toContain('ConcurrencyConflict');
    expect(checkpoints.peek(REACTOR_CONSUMER)).toBe(1);
  });

  it('holds the checkpoint when the exhausted effect cannot even be dead-lettered', async () => {
    await seed([requested()]);
    const interpret = vi.fn(() => errAsync(infraError('bridge.propose', 'beets always fails')));
    deadLetters.failRecord = true;
    const r = reactor(interpret, { retryBudget: 1 });

    await r.start(); // budget of 1: the first failure tries to dead-letter, which itself fails
    expect(deadLetters.letters).toHaveLength(0);
    expect(checkpoints.peek(REACTOR_CONSUMER)).toBeUndefined();
  });

  it('reacts against the stream prefix as of the event, not a whole-stream fold', async () => {
    const ref = candidate().ref;
    await seed([
      requested(),
      {
        type: 'CandidatesProposed',
        candidates: [candidate({ distance: asDistance(0.01) })],
        duplicates: [],
      },
      { type: 'AutoApplySelected', ref, distance: asDistance(0.01) },
      { type: 'ImportApplied', location: '/library/Artist/Album' },
    ]);
    const interpret = vi.fn(() => okAsync([]));
    const autoApply = store.all().find((entry) => entry.type === 'AutoApplySelected')!;

    await reactor(interpret).process(autoApply);

    // Folded over the prefix up to and including AutoApplySelected the phase is `applying`, so Apply
    // fires exactly once; a whole-stream fold would see the trailing ImportApplied (`applied`) and
    // never react. The checkpoint advances precisely to that event.
    expect(interpret).toHaveBeenCalledTimes(1);
    expect(interpret).toHaveBeenCalledWith('imp-1', expect.objectContaining({ type: 'Apply' }));
    expect(checkpoints.peek(REACTOR_CONSUMER)).toBe(autoApply.globalSeq);
  });
});

describe('Reactor — durable retry budget & stalled exposure', () => {
  it('resumes the retry tally across restarts instead of re-retrying from zero', async () => {
    await seed([requested()]);
    const interpret = vi.fn(() => errAsync(infraError('bridge.propose', 'beets always fails')));
    // Each boot is a fresh reactor instance over the SAME durable stores — a process restart.
    const boot = async (): Promise<void> => {
      const r = reactor(interpret, { retryBudget: 3 });
      await r.start();
      r.stop();
    };

    await boot(); // attempt 1: parked, held
    expect(parked.peek(1)?.attempt).toBe(1);
    expect(deadLetters.letters).toHaveLength(0);

    await boot(); // attempt 2: resumes the durable tally (would be 1 again if it were in memory)
    expect(parked.peek(1)?.attempt).toBe(2);
    expect(deadLetters.letters).toHaveLength(0);

    await boot(); // attempt 3 hits the budget: dead-lettered and advanced past
    expect(deadLetters.letters).toHaveLength(1);
    expect(deadLetters.letters[0]?.streamId).toBe('imp-1'); // the letter names its owning import
    expect(parked.peek(1)).toBeUndefined(); // the tally is cleared once dead-lettered
    expect(stalled.isStalled('imp-1')).toBe(true); // the import is exposed as stalled
    expect(checkpoints.peek(REACTOR_CONSUMER)).toBe(1); // the queue is not wedged behind the poison
  });

  it('holds the checkpoint when the durable retry tally cannot be written', async () => {
    await seed([requested()]);
    parked.failPark = true;
    const interpret = vi.fn(() => errAsync(infraError('bridge.propose', 'spawn failed')));
    await reactor(interpret).start();

    expect(interpret).toHaveBeenCalled(); // the hold came from the park-write fault, not an early return
    expect(checkpoints.peek(REACTOR_CONSUMER)).toBeUndefined();
    expect(deadLetters.letters).toHaveLength(0);
  });

  it('holds the checkpoint when the durable retry tally cannot be read', async () => {
    await seed([requested()]);
    parked.failFind = true;
    const interpret = vi.fn(() => errAsync(infraError('bridge.propose', 'spawn failed')));
    await reactor(interpret).start();

    expect(interpret).toHaveBeenCalled(); // the hold came from the find fault, not an early return
    expect(checkpoints.peek(REACTOR_CONSUMER)).toBeUndefined();
  });

  it('advances even when clearing the resolved retry tally fails (harmless leftover)', async () => {
    await seed([requested()]);
    parked.failClear = true;
    const interpret = vi.fn(() => okAsync([]));
    await reactor(interpret).start();

    expect(checkpoints.peek(REACTOR_CONSUMER)).toBe(1);
  });

  it('clears the stalled exposure and its dead letters once the stream drives again', async () => {
    await seed([requested()]);
    // A prior boot dead-lettered this import; the durable letter and the stalled mark are present.
    stalled.mark('imp-1');
    await deadLetters.record({
      subscription: REACTOR_CONSUMER,
      globalSeq: 0,
      error: 'Propose: bridge.propose: was down',
      occurredAt: 't',
      streamId: 'imp-1',
    });
    const interpret = vi.fn(() => okAsync([]));
    await reactor(interpret).start();

    expect(stalled.isStalled('imp-1')).toBe(false);
    expect(deadLetters.letters).toHaveLength(0);
    expect(checkpoints.peek(REACTOR_CONSUMER)).toBe(1);
  });

  it('leaves the import stalled when clearing its resolved dead letters fails', async () => {
    await seed([requested()]);
    stalled.mark('imp-1');
    deadLetters.failClearStream = true;
    const interpret = vi.fn(() => okAsync([]));
    await reactor(interpret).start();

    expect(stalled.isStalled('imp-1')).toBe(true); // stays marked — the letters still exist
    expect(checkpoints.peek(REACTOR_CONSUMER)).toBe(1); // but the stream still advances
  });
});
