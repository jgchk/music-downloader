import { errAsync, okAsync } from 'neverthrow';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { REACTOR_CONSUMER, Reactor } from './reactor.js';
import type { ReactorDeps } from './reactor.js';
import type { EffectPorts, InterpreterDeps } from './interpreter.js';
import {
  FakeCheckpointStore,
  FakeDeadLetterStore,
  FakeEventBus,
  FakeEventStore,
  FakeParkedEffectStore,
  settableClock,
  silentLogger,
} from '../__fixtures__/fakes.js';
import type { SettableClock } from '../__fixtures__/fakes.js';
import { createLogger } from '../logging/logger.js';
import { infraError, permanentInfraError } from '../ports/errors.js';
import type { AcquisitionEvent } from '../../domain/acquisition/events.js';
import type { StoredEvent } from '../ports/event-store-port.js';
import type { RetryPolicy } from './retry-policy.js';
import {
  importingHistory,
  matchingCandidate,
  requestedHistory,
  resolvedHistory,
  sampleFiles,
  sampleTarget,
  selectedHistory,
  validatingHistory,
} from '../../domain/acquisition/__fixtures__/acquisition-fixtures.js';

function stubPorts(overrides: Partial<EffectPorts> = {}): EffectPorts {
  return {
    metadata: {
      resolve: vi.fn(() => okAsync({ kind: 'resolved' as const, target: sampleTarget })),
    },
    search: { search: vi.fn(() => okAsync([])) },
    download: {
      download: vi.fn(() => okAsync({ kind: 'failed' as const, reason: 'Stalled' as const })),
      abort: vi.fn(() => okAsync([])),
    },
    probe: { probe: vi.fn() },
    library: { import: vi.fn(), discardStaging: vi.fn(() => okAsync(undefined)) },
    ...overrides,
  };
}

let store: FakeEventStore;
let checkpoints: FakeCheckpointStore;
let bus: FakeEventBus;
let parked: FakeParkedEffectStore;
let deadLetters: FakeDeadLetterStore;
let clock: SettableClock;

function interpreter(ports: EffectPorts): InterpreterDeps {
  return { store, clock, ports, onProgress: vi.fn() };
}

interface ReactorOverrides {
  readonly interval?: (fn: () => void, ms: number) => () => void;
  readonly retryPolicy?: RetryPolicy;
  readonly random?: () => number;
  readonly logger?: ReactorDeps['logger'];
}

function reactor(ports: EffectPorts, overrides: ReactorOverrides = {}): Reactor {
  const deps: ReactorDeps = {
    store,
    checkpoints,
    bus,
    parked,
    deadLetters,
    logger: overrides.logger ?? silentLogger(),
    interpreter: interpreter(ports),
    // Tests drive drains explicitly; the default real interval is covered by its own test below.
    interval: overrides.interval ?? (() => () => {}),
    retryPolicy: overrides.retryPolicy,
    // Deterministic full-step jitter: the delay equals the exponential step exactly.
    random: overrides.random ?? (() => 1),
  };
  return new Reactor(deps);
}

async function seed(history: readonly AcquisitionEvent[], streamId = 'acq-1'): Promise<void> {
  const current = store.all().filter((entry) => entry.streamId === streamId).length;
  await store.append(streamId, current, history, { acquisitionId: streamId, occurredAt: 't' });
}

function storedOfType(type: AcquisitionEvent['type']): StoredEvent {
  const found = store.all().find((entry) => entry.type === type);
  if (found === undefined) throw new Error(`no stored event of type ${type}`);
  return found;
}

function streamEventTypes(streamId: string): readonly string[] {
  return store
    .all()
    .filter((entry) => entry.streamId === streamId)
    .map((entry) => entry.type);
}

const importedThenFulfilled = (cands: readonly ReturnType<typeof matchingCandidate>[]) => [
  ...importingHistory(cands),
  {
    type: 'Imported' as const,
    candidate: cands[0]!.identity,
    location: '/lib/kid-a',
    files: sampleFiles,
  },
  { type: 'AcquisitionFulfilled' as const, location: '/lib/kid-a' },
];

/** A tight budget for exhaustion specs: one 5s step, spent after a minute. */
const TIGHT_BUDGET: RetryPolicy = { initialDelayMs: 5_000, maxDelayMs: 5_000, budgetMs: 60_000 };

beforeEach(() => {
  store = new FakeEventStore();
  checkpoints = new FakeCheckpointStore();
  bus = new FakeEventBus();
  parked = new FakeParkedEffectStore();
  deadLetters = new FakeDeadLetterStore();
  clock = settableClock('2026-07-22T12:00:00.000Z');
});

describe('Reactor.start', () => {
  it('drains the backlog, dispatches effects, and checkpoints', async () => {
    await seed(requestedHistory());
    const ports = stubPorts();
    await reactor(ports).start();
    expect(ports.metadata.resolve).toHaveBeenCalledOnce();
    expect(checkpoints.peek(REACTOR_CONSUMER)).toBe(1);
    expect(bus.subscriberCount()).toBe(1);
  });

  it('does not re-dispatch an already-checkpointed in-flight download after a restart', async () => {
    await seed(selectedHistory([matchingCandidate('a')])); // ends at CandidateSelected (globalSeq 5)
    await checkpoints.save(REACTOR_CONSUMER, 5); // as if processed just before the crash
    const ports = stubPorts();
    await reactor(ports).start();
    expect(ports.download.download).not.toHaveBeenCalled();
  });

  it('subscribes even when catch-up fails, and tolerates a checkpoint load failure', async () => {
    store.failReadAll = true;
    checkpoints.failLoad = true;
    await reactor(stubPorts()).start();
    expect(bus.subscriberCount()).toBe(1);
  });

  it('processes live events delivered on the bus after start', async () => {
    const ports = stubPorts();
    await reactor(ports).start();
    await seed(requestedHistory());
    bus.publish(store.all());
    await vi.waitFor(() => {
      expect(ports.metadata.resolve).toHaveBeenCalledOnce();
    });
  });

  it('stops following live events on stop()', async () => {
    const r = reactor(stubPorts());
    await r.start();
    r.stop();
    expect(bus.subscriberCount()).toBe(0);
  });
});

describe('Reactor.process', () => {
  it('ignores an already-processed event (at-least-once dedupe)', async () => {
    await seed(requestedHistory());
    const ports = stubPorts();
    const r = reactor(ports);
    const event = store.all()[0]!;
    await r.process(event);
    await r.process(event);
    expect(ports.metadata.resolve).toHaveBeenCalledOnce();
  });

  it('advances the checkpoint for an event with no effect', async () => {
    await seed([...resolvedHistory(), { type: 'SearchCompleted', round: 1, candidates: [] }]);
    const ports = stubPorts();
    const searchCompleted = store.all().at(-1)!;
    await reactor(ports).process(searchCompleted);
    expect(checkpoints.peek(REACTOR_CONSUMER)).toBe(searchCompleted.globalSeq);
    expect(ports.metadata.resolve).not.toHaveBeenCalled();
  });

  it('logs and bails without checkpointing when the stream read fails', async () => {
    await seed(requestedHistory());
    const event = store.all()[0]!;
    const ports = stubPorts();
    store.failReads = true;
    await reactor(ports).process(event);
    expect(checkpoints.peek(REACTOR_CONSUMER)).toBeUndefined();
    expect(ports.metadata.resolve).not.toHaveBeenCalled();
  });

  it('bails without checkpointing when the park state cannot be read', async () => {
    await seed(requestedHistory());
    const event = store.all()[0]!;
    const ports = stubPorts();
    parked.failFind = true;
    await reactor(ports).process(event);
    expect(checkpoints.peek(REACTOR_CONSUMER)).toBeUndefined();
    expect(ports.metadata.resolve).not.toHaveBeenCalled();
  });

  it('advances the checkpoint when an effect follow-on is rejected as a stale domain transition', async () => {
    // The stream has already advanced past Pending, so the re-fired ResolveMetadata's RecordTarget
    // is an IllegalTransition — a stale-outcome rejection, not an infra fault. It must not wedge the
    // consumer: record it and advance past the event (design D5).
    await seed(resolvedHistory()); // AcquisitionRequested (seq 1) then TargetResolved (seq 2)
    const requested = storedOfType('AcquisitionRequested');
    const ports = stubPorts(); // metadata.resolve returns a resolved target → RecordTarget
    await reactor(ports).process(requested);
    expect(checkpoints.peek(REACTOR_CONSUMER)).toBe(requested.globalSeq);
  });

  it('processes events published while the startup drain is running (no wakeup gap)', async () => {
    // Production stores publish post-commit; an effect fired from the backlog appends (and
    // publishes) follow-ons mid-drain. The subscription must be attached before the drain and the
    // wakeup must coalesce into another pass — a snapshot-then-subscribe drops the follow-ons
    // into the gap and a crash-resumed chain stalls (found by the out-of-process restart e2e).
    await seed(requestedHistory());
    const resolution = { kind: 'unresolved' as const };
    const resolve = vi.fn(() => {
      if (resolve.mock.calls.length === 1) {
        // First delivery (acq-1, from the backlog): a second stream lands and publishes while
        // this very effect is still being processed — the mid-drain wakeup.
        return store
          .append('acq-2', 0, requestedHistory(), { acquisitionId: 'acq-2', occurredAt: 't' })
          .map((appended) => {
            bus.publish(appended);
            return resolution;
          });
      }
      return okAsync(resolution);
    });
    const ports = stubPorts({ metadata: { resolve: resolve as never } });
    const r = reactor(ports);
    await r.start();

    // Both streams' ResolveMetadata effects fired: acq-1 from the backlog, acq-2 from the wakeup
    // that landed mid-drain and coalesced into the next pass.
    await vi.waitFor(() => {
      expect(resolve.mock.calls.length).toBeGreaterThanOrEqual(2);
    });
    r.stop();
  });

  it('polls on a real timer by default, and stop() clears it', async () => {
    vi.useFakeTimers();
    try {
      const ports = stubPorts();
      const r = new Reactor({
        store,
        checkpoints,
        bus,
        parked,
        deadLetters,
        logger: silentLogger(),
        interpreter: interpreter(ports),
      });
      await r.start();

      await seed(requestedHistory()); // appended without a publish: only the poll can find it
      await vi.advanceTimersByTimeAsync(5_000);
      expect(ports.metadata.resolve).toHaveBeenCalledOnce();

      r.stop();
      await vi.advanceTimersByTimeAsync(60_000);
      expect(ports.metadata.resolve).toHaveBeenCalledOnce();
    } finally {
      vi.useRealTimers();
    }
  });
});

describe('Reactor — per-stream parking (reactor-durability D1)', () => {
  it('parks the stream on a retryable effect failure and ADVANCES the global checkpoint', async () => {
    await seed(requestedHistory());
    const ports = stubPorts({
      metadata: { resolve: vi.fn(() => errAsync(infraError('mb', 'down'))) },
    });
    const r = reactor(ports);
    await r.start();

    expect(checkpoints.peek(REACTOR_CONSUMER)).toBe(1); // advanced past the poisoned event
    expect(parked.peek('acq-1')).toMatchObject({
      streamId: 'acq-1',
      globalSeq: 1,
      attempt: 1,
      parkedAt: '2026-07-22T12:00:00.000Z',
      nextRetryAt: '2026-07-22T12:00:05.000Z', // initial 5s step, full-jitter roll
    });
    r.stop();
  });

  it('processes another acquisition immediately while one is parked (the isolation scenario)', async () => {
    await seed(requestedHistory(), 'acq-1');
    await seed(requestedHistory(), 'acq-2');
    const resolve = vi
      .fn()
      .mockReturnValueOnce(errAsync(infraError('mb', 'down'))) // acq-1: poisoned
      .mockReturnValue(okAsync({ kind: 'unresolved' as const })); // acq-2: proceeds
    const r = reactor(stubPorts({ metadata: { resolve } }));
    await r.start();

    expect(parked.peek('acq-1')).toBeDefined();
    expect(streamEventTypes('acq-2')).toContain('MetadataResolutionFailed'); // its own outcome
    expect(checkpoints.peek(REACTOR_CONSUMER)).toBe(2);
    r.stop();
  });

  it('holds the checkpoint when the park itself cannot be written (durable fallback)', async () => {
    await seed(requestedHistory());
    parked.failPark = true;
    const r = reactor(
      stubPorts({ metadata: { resolve: vi.fn(() => errAsync(infraError('mb', 'down'))) } }),
    );
    await r.start();

    expect(checkpoints.peek(REACTOR_CONSUMER)).toBeUndefined();
    r.stop();
  });
});

describe('Reactor — ordering under park (no-leapfrog invariant)', () => {
  it('queues later events of a parked stream and dispatches them in order after the park resolves', async () => {
    const a = matchingCandidate('a');
    await seed(selectedHistory([a])); // ends CandidateSelected (seq 5) → Download effect
    const download = vi
      .fn()
      .mockReturnValueOnce(errAsync(infraError('slskd', 'down')))
      .mockReturnValue(okAsync({ kind: 'completed' as const, files: sampleFiles }));
    const abort = vi.fn(() => okAsync([]));
    const ports = stubPorts({ download: { download, abort } });
    const r = reactor(ports);

    await r.start(); // parks acq-1 at the CandidateSelected download
    expect(parked.peek('acq-1')).toMatchObject({ globalSeq: 5 });

    // A later event lands while the stream is parked: the cancellation's abort effect must wait.
    await seed([{ type: 'AcquisitionCancelled' }]);
    await r.drain();
    expect(checkpoints.peek(REACTOR_CONSUMER)).toBe(6); // advanced past it (queued, not lost)
    expect(abort).not.toHaveBeenCalled(); // N+1 never leapfrogs parked N

    // The parked download retries and settles (stale against the now-cancelled stream), then the
    // queued cancellation dispatches in order: abort → the pending candidate's rejection.
    clock.advance(5_000);
    await r.drain();
    expect(abort).toHaveBeenCalledOnce();
    expect(streamEventTypes('acq-1')).toContain('CandidateRejected');
    expect(parked.peek('acq-1')).toBeUndefined();
    r.stop();
  });

  it('re-parks the stream when a queued event fails during catch-up', async () => {
    const a = matchingCandidate('a');
    await seed(selectedHistory([a]));
    const download = vi
      .fn()
      .mockReturnValueOnce(errAsync(infraError('slskd', 'down')))
      .mockReturnValue(okAsync({ kind: 'completed' as const, files: sampleFiles }));
    const abort = vi.fn(() => errAsync(infraError('slskd.abort', 'down')));
    const r = reactor(stubPorts({ download: { download, abort } }));

    await r.start(); // parked at seq 5
    await seed([{ type: 'AcquisitionCancelled' }]);
    await r.drain(); // queued behind the park

    clock.advance(5_000);
    await r.drain(); // download settles; catch-up hits the failing abort → fresh park at seq 6
    expect(parked.peek('acq-1')).toMatchObject({ globalSeq: 6, attempt: 1 });
    r.stop();
  });
});

describe('Reactor — retry scheduler (reactor-durability D2)', () => {
  it('re-dispatches a due parked effect with backoff, incrementing the attempt', async () => {
    await seed(requestedHistory());
    const resolve = vi.fn(() => errAsync(infraError('mb', 'down')));
    const r = reactor(stubPorts({ metadata: { resolve } }));
    await r.start();
    expect(resolve).toHaveBeenCalledTimes(1);

    await r.drain(); // not due yet — no retry
    expect(resolve).toHaveBeenCalledTimes(1);

    clock.advance(5_000); // due: first backoff step
    await r.drain();
    expect(resolve).toHaveBeenCalledTimes(2);
    expect(parked.peek('acq-1')).toMatchObject({
      attempt: 2,
      nextRetryAt: '2026-07-22T12:00:15.000Z', // 5s + doubled 10s step
    });

    clock.advance(5_000); // 12:00:10 — second step not due yet
    await r.drain();
    expect(resolve).toHaveBeenCalledTimes(2);
    r.stop();
  });

  it('clears the park and resumes the stream when a retry succeeds', async () => {
    await seed(requestedHistory());
    const resolve = vi
      .fn()
      .mockReturnValueOnce(errAsync(infraError('mb', 'down')))
      .mockReturnValue(okAsync({ kind: 'unresolved' as const }));
    const r = reactor(stubPorts({ metadata: { resolve } }));
    await r.start();

    clock.advance(5_000);
    await r.drain();

    expect(parked.count()).toBe(0);
    expect(streamEventTypes('acq-1')).toContain('MetadataResolutionFailed');
    r.stop();
  });

  it('retries a transiently failed effect on the fallback poll, with no new event', async () => {
    await seed(requestedHistory());
    const ticks: (() => void)[] = [];
    const resolve = vi
      .fn()
      .mockReturnValueOnce(errAsync(infraError('mb', 'down')))
      .mockReturnValue(okAsync({ kind: 'unresolved' as const }));
    const ports = stubPorts({ metadata: { resolve } });
    const r = reactor(ports, {
      interval: (fn) => {
        ticks.push(fn);
        return () => {};
      },
    });
    await r.start();
    expect(parked.peek('acq-1')).toBeDefined();

    clock.advance(5_000);
    ticks[0]!(); // the fallback poll fires — nothing else does
    await vi.waitFor(() => {
      expect(resolve).toHaveBeenCalledTimes(2);
    });
    r.stop();
  });

  it('clears a park whose event no longer exists and lets the re-drive reconcile', async () => {
    await parked.park({
      streamId: 'acq-ghost',
      globalSeq: 99,
      attempt: 1,
      parkedAt: '2026-07-22T11:00:00.000Z',
      nextRetryAt: '2026-07-22T11:00:05.000Z',
      lastError: 'mb: down',
    });
    const r = reactor(stubPorts());
    await r.start();
    expect(parked.count()).toBe(0);
    r.stop();
  });

  it('keeps the park scheduled when the retry cannot read the stream', async () => {
    await seed(requestedHistory());
    const resolve = vi.fn(() => errAsync(infraError('mb', 'down')));
    const r = reactor(stubPorts({ metadata: { resolve } }));
    await r.start();

    clock.advance(5_000);
    store.failReads = true;
    await r.drain();
    expect(parked.peek('acq-1')).toMatchObject({ attempt: 1 }); // untouched — retried next tick
    r.stop();
  });

  it('tolerates a due-listing failure and retries on a later tick', async () => {
    await seed(requestedHistory());
    const resolve = vi.fn(() => errAsync(infraError('mb', 'down')));
    const r = reactor(stubPorts({ metadata: { resolve } }));
    await r.start();

    clock.advance(5_000);
    parked.failDue = true;
    await r.drain();
    expect(resolve).toHaveBeenCalledTimes(1);

    parked.failDue = false;
    await r.drain();
    expect(resolve).toHaveBeenCalledTimes(2);
    r.stop();
  });
});

describe('Reactor — budget exhaustion lands somewhere modeled (reactor-durability D2)', () => {
  it('degrades ResolveMetadata to the modeled metadata failure through the command path', async () => {
    await seed(requestedHistory());
    const resolve = vi.fn(() => errAsync(infraError('mb', 'down')));
    const r = reactor(stubPorts({ metadata: { resolve } }), { retryPolicy: TIGHT_BUDGET });
    await r.start();

    clock.advance(61_000); // beyond the wall-clock budget
    await r.drain();

    expect(streamEventTypes('acq-1')).toContain('MetadataResolutionFailed');
    expect(parked.count()).toBe(0);
    expect(deadLetters.letters).toEqual([]); // modeled landing, not a dead letter
    r.stop();
  });

  it('dead-letters an effect with no modeled failure and records the owning stream', async () => {
    // A CandidateRejected cleanup (no modeled failure path) that fails for the whole budget.
    const a = matchingCandidate('a');
    await seed([
      ...selectedHistory([a]),
      { type: 'DownloadFailed', candidate: a.identity, reason: 'Stalled' },
      { type: 'CandidateRejected', candidate: a.identity, files: sampleFiles },
    ]);
    await checkpoints.save(REACTOR_CONSUMER, 6); // only the rejection's cleanup is pending
    const discardStaging = vi.fn(() => errAsync(infraError('fs', 'denied')));
    const r = reactor(stubPorts({ library: { import: vi.fn(), discardStaging } }), {
      retryPolicy: TIGHT_BUDGET,
    });
    await r.start();
    expect(parked.peek('acq-1')).toMatchObject({ globalSeq: 7 });

    clock.advance(61_000);
    await r.drain();

    expect(parked.count()).toBe(0);
    expect(deadLetters.letters).toHaveLength(1);
    expect(deadLetters.letters[0]).toMatchObject({
      subscription: REACTOR_CONSUMER,
      globalSeq: 7,
      streamId: 'acq-1',
    });
    expect(deadLetters.letters[0]!.error).toContain('Cleanup');
    r.stop();
  });

  it('short-circuits the budget for a permanent fault: modeled failure lands immediately', async () => {
    await seed(requestedHistory());
    const resolve = vi.fn(() => errAsync(permanentInfraError('mb', 'schema drift')));
    const r = reactor(stubPorts({ metadata: { resolve } }));
    await r.start();

    expect(resolve).toHaveBeenCalledOnce(); // no retries
    expect(parked.count()).toBe(0);
    expect(streamEventTypes('acq-1')).toContain('MetadataResolutionFailed');
    expect(checkpoints.peek(REACTOR_CONSUMER)).toBe(1);
    r.stop();
  });

  it('short-circuits the budget for a permanent fault: no modeled failure dead-letters immediately', async () => {
    const a = matchingCandidate('a');
    await seed([
      ...selectedHistory([a]),
      { type: 'DownloadFailed', candidate: a.identity, reason: 'Stalled' },
      { type: 'CandidateRejected', candidate: a.identity, files: sampleFiles },
    ]);
    await checkpoints.save(REACTOR_CONSUMER, 6);
    const discardStaging = vi.fn(() => errAsync(permanentInfraError('fs', 'path outside root')));
    const r = reactor(stubPorts({ library: { import: vi.fn(), discardStaging } }));
    await r.start();

    expect(discardStaging).toHaveBeenCalledOnce();
    expect(parked.count()).toBe(0);
    expect(deadLetters.letters).toHaveLength(1);
    expect(deadLetters.letters[0]).toMatchObject({ streamId: 'acq-1' });
    r.stop();
  });

  it('keeps the park when the dead-letter write fails, and lands on a later tick', async () => {
    const a = matchingCandidate('a');
    await seed([
      ...selectedHistory([a]),
      { type: 'DownloadFailed', candidate: a.identity, reason: 'Stalled' },
      { type: 'CandidateRejected', candidate: a.identity, files: sampleFiles },
    ]);
    await checkpoints.save(REACTOR_CONSUMER, 6);
    const discardStaging = vi.fn(() => errAsync(infraError('fs', 'denied')));
    const r = reactor(stubPorts({ library: { import: vi.fn(), discardStaging } }), {
      retryPolicy: TIGHT_BUDGET,
    });
    await r.start();

    clock.advance(61_000);
    deadLetters.failRecord = true;
    await r.drain();
    expect(parked.peek('acq-1')).toBeDefined(); // still parked — the landing must not be lost

    deadLetters.failRecord = false;
    await r.drain();
    expect(parked.count()).toBe(0);
    expect(deadLetters.letters).toHaveLength(1);
    r.stop();
  });

  it('degrades an exhausted Download to the modeled stalled rejection', async () => {
    const a = matchingCandidate('a');
    await seed(selectedHistory([a]));
    const download = vi.fn(() => errAsync(infraError('slskd', 'down')));
    const abort = vi.fn(() => okAsync([]));
    const r = reactor(stubPorts({ download: { download, abort } }), { retryPolicy: TIGHT_BUDGET });
    await r.start();

    clock.advance(61_000);
    await r.drain();

    expect(streamEventTypes('acq-1')).toContain('CandidateRejected');
    expect(parked.count()).toBe(0);
    expect(deadLetters.letters).toEqual([]);
    r.stop();
  });

  it('degrades an exhausted AbortDownload to the modeled cancelled rejection', async () => {
    const a = matchingCandidate('a');
    await seed([...selectedHistory([a]), { type: 'AcquisitionCancelled' }]);
    await checkpoints.save(REACTOR_CONSUMER, 5); // only the cancellation's abort is pending
    const download = vi.fn();
    const abort = vi.fn(() => errAsync(infraError('slskd.abort', 'down')));
    const r = reactor(stubPorts({ download: { download, abort } }), { retryPolicy: TIGHT_BUDGET });
    await r.start();
    expect(parked.peek('acq-1')).toMatchObject({ globalSeq: 6 });

    clock.advance(61_000);
    await r.drain();

    expect(streamEventTypes('acq-1')).toContain('CandidateRejected');
    expect(parked.count()).toBe(0);
    expect(deadLetters.letters).toEqual([]);
    r.stop();
  });

  it('lands the very first failure when the budget is zero-width', async () => {
    await seed(requestedHistory());
    const resolve = vi.fn(() => errAsync(infraError('mb', 'down')));
    const r = reactor(stubPorts({ metadata: { resolve } }), {
      retryPolicy: { initialDelayMs: 5_000, maxDelayMs: 5_000, budgetMs: 0 },
    });
    await r.start();

    expect(resolve).toHaveBeenCalledOnce();
    expect(parked.count()).toBe(0);
    expect(streamEventTypes('acq-1')).toContain('MetadataResolutionFailed');
    r.stop();
  });

  it('lands immediately when a parked retry fails with a permanent fault', async () => {
    await seed(requestedHistory());
    const resolve = vi
      .fn()
      .mockReturnValueOnce(errAsync(infraError('mb', 'down')))
      .mockReturnValue(errAsync(permanentInfraError('mb', 'schema drift')));
    const r = reactor(stubPorts({ metadata: { resolve } }));
    await r.start();

    clock.advance(5_000); // well inside the 6h budget — the permanent fault short-circuits it
    await r.drain();

    expect(parked.count()).toBe(0);
    expect(streamEventTypes('acq-1')).toContain('MetadataResolutionFailed');
    r.stop();
  });

  it('parks a permanent fault whose dead-letter landing cannot be written', async () => {
    const a = matchingCandidate('a');
    await seed([
      ...selectedHistory([a]),
      { type: 'DownloadFailed', candidate: a.identity, reason: 'Stalled' },
      { type: 'CandidateRejected', candidate: a.identity, files: sampleFiles },
    ]);
    await checkpoints.save(REACTOR_CONSUMER, 6);
    deadLetters.failRecord = true;
    const discardStaging = vi.fn(() => errAsync(permanentInfraError('fs', 'path outside root')));
    const r = reactor(stubPorts({ library: { import: vi.fn(), discardStaging } }));
    await r.start();

    expect(parked.peek('acq-1')).toBeDefined(); // the landing is preserved as a park, not lost
    r.stop();
  });

  it('keeps the previous schedule when a retry reschedule cannot be written', async () => {
    await seed(requestedHistory());
    const resolve = vi.fn(() => errAsync(infraError('mb', 'down')));
    const r = reactor(stubPorts({ metadata: { resolve } }));
    await r.start();

    clock.advance(5_000);
    parked.failPark = true;
    await r.drain();
    expect(parked.peek('acq-1')).toMatchObject({ attempt: 1 }); // unchanged; a later tick retries
    r.stop();
  });

  it('keeps the park when the degrade command fails on infrastructure', async () => {
    await seed(requestedHistory());
    const resolve = vi.fn(() => errAsync(infraError('mb', 'down')));
    const r = reactor(stubPorts({ metadata: { resolve } }), { retryPolicy: TIGHT_BUDGET });
    await r.start();

    clock.advance(61_000);
    const append = vi
      .spyOn(store, 'append')
      .mockReturnValue(errAsync(infraError('event-store.append', 'disk full')));
    await r.drain();
    expect(parked.peek('acq-1')).toBeDefined(); // the modeled landing must not be lost

    append.mockRestore();
    await r.drain();
    expect(parked.count()).toBe(0);
    expect(streamEventTypes('acq-1')).toContain('MetadataResolutionFailed');
    r.stop();
  });

  it('parks on a concurrency conflict, recording the conflict as the last error', async () => {
    await seed(requestedHistory());
    const append = vi
      .spyOn(store, 'append')
      .mockReturnValue(
        errAsync({ kind: 'ConcurrencyConflict' as const, streamId: 'acq-1', expectedVersion: 1 }),
      );
    const r = reactor(
      stubPorts({ metadata: { resolve: vi.fn(() => okAsync({ kind: 'unresolved' as const })) } }),
    );
    await r.start();

    expect(parked.peek('acq-1')?.lastError).toContain('ConcurrencyConflict');
    append.mockRestore();
    r.stop();
  });

  it('rolls real jitter by default when parking', async () => {
    await seed(requestedHistory());
    const ports = stubPorts({
      metadata: { resolve: vi.fn(() => errAsync(infraError('mb', 'down'))) },
    });
    const r = new Reactor({
      store,
      checkpoints,
      bus,
      parked,
      deadLetters,
      logger: silentLogger(),
      interpreter: interpreter(ports),
      interval: () => () => {},
    });
    await r.start();
    expect(parked.peek('acq-1')).toBeDefined();
    r.stop();
  });

  it('treats a degrade rejected by the domain as landed (the stream already settled it)', async () => {
    // The resolution is parked, then the user cancels: by the time the budget exhausts, the
    // degrade's RecordMetadataFailed is an IllegalTransition — the acquisition already terminal.
    await seed(requestedHistory());
    const resolve = vi.fn(() => errAsync(infraError('mb', 'down')));
    const r = reactor(stubPorts({ metadata: { resolve } }), { retryPolicy: TIGHT_BUDGET });
    await r.start();
    await seed([{ type: 'AcquisitionCancelled' }]);
    await r.drain(); // queued behind the park

    clock.advance(61_000);
    await r.drain();

    expect(parked.count()).toBe(0);
    expect(deadLetters.letters).toEqual([]);
    expect(streamEventTypes('acq-1')).not.toContain('MetadataResolutionFailed');
    r.stop();
  });

  it('treats a degrade the domain rejects as illegal as landed (stream moved past the phase)', async () => {
    // A park left behind by a crash while the stream itself has since advanced: the exhausted
    // degrade's RecordMetadataFailed is illegal against Searching — the rejection settles the park.
    await seed(resolvedHistory()); // seq 1 requested, seq 2 resolved (Searching)
    await checkpoints.save(REACTOR_CONSUMER, 2);
    await parked.park({
      streamId: 'acq-1',
      globalSeq: 1,
      attempt: 3,
      parkedAt: '2026-07-22T10:00:00.000Z', // budget long spent
      nextRetryAt: '2026-07-22T11:59:00.000Z',
      lastError: 'mb: down',
    });
    const resolve = vi.fn(() => errAsync(infraError('mb', 'down')));
    const r = reactor(stubPorts({ metadata: { resolve } }), { retryPolicy: TIGHT_BUDGET });
    await r.start();

    expect(parked.count()).toBe(0);
    expect(deadLetters.letters).toEqual([]);
    r.stop();
  });

  it('logs structured park, degrade, and dead-letter transitions', async () => {
    const lines: string[] = [];
    const logger = createLogger({
      level: 'debug',
      destination: { write: (line: string) => void lines.push(line) },
    });
    await seed(requestedHistory());
    const resolve = vi.fn(() => errAsync(infraError('mb', 'down')));
    const r = reactor(stubPorts({ metadata: { resolve } }), {
      retryPolicy: TIGHT_BUDGET,
      logger,
    });
    await r.start();
    clock.advance(61_000);
    await r.drain();
    r.stop();

    const entries = lines.map((line) => JSON.parse(line) as Record<string, unknown>);
    const parkedEntry = entries.find((entry) => entry.msg === 'effect parked for retry');
    expect(parkedEntry).toMatchObject({
      acquisitionId: 'acq-1',
      effect: 'ResolveMetadata',
      attempt: 1,
    });
    expect(parkedEntry).toHaveProperty('nextRetryAt');
    expect(
      entries.find((entry) => entry.msg === 'retry budget exhausted; degrading to modeled failure'),
    ).toMatchObject({ acquisitionId: 'acq-1', effect: 'ResolveMetadata' });
  });
});

describe('Reactor.process — reacts against the state as of the event (prefix fold)', () => {
  it('re-fires an event effect on redelivery, matching first-delivery semantics', async () => {
    // ValidationPassed is folded to Importing at its own position; the whole stream has since reached
    // Fulfilled. Reacting against the prefix (Importing) re-fires Import; reacting against the latest
    // fold (Fulfilled) would silently swallow it. Redelivery must reproduce first-delivery effects.
    await seed(importedThenFulfilled([matchingCandidate('a')]));
    const validationPassed = storedOfType('ValidationPassed');
    const ports = stubPorts({
      library: {
        import: vi.fn(() => okAsync({ kind: 'imported' as const, location: '/lib/kid-a' })),
        discardStaging: vi.fn(() => okAsync(undefined)),
      },
    });
    await reactor(ports).process(validationPassed);
    expect(ports.library.import).toHaveBeenCalledOnce();
    // The re-import's RecordImported hits the already-terminal stream → decide no-ops → checkpoint advances.
    expect(checkpoints.peek(REACTOR_CONSUMER)).toBe(validationPassed.globalSeq);
  });

  it('reacts to a co-emitted non-final event against its own post-state, not the batch successor', async () => {
    // Imported is co-emitted with AcquisitionFulfilled; reacting to Imported folds only through
    // Imported (still Importing, current candidate present), so the Cleanup effect fires.
    await seed(importedThenFulfilled([matchingCandidate('a')]));
    const imported = storedOfType('Imported');
    const ports = stubPorts({
      library: {
        import: vi.fn(() => okAsync({ kind: 'imported' as const, location: '/lib/kid-a' })),
        discardStaging: vi.fn(() => okAsync(undefined)),
      },
    });
    await reactor(ports).process(imported);
    expect(ports.library.discardStaging).toHaveBeenCalledWith(sampleFiles);
    expect(checkpoints.peek(REACTOR_CONSUMER)).toBe(imported.globalSeq);
  });

  it('re-fires Download on redelivery of CandidateSelected, then advances past the stale completion', async () => {
    // Redelivered CandidateSelected folds to Downloading at its position (the stream has since reached
    // Validating). Download re-fires; the stale RecordDownloadCompleted is an IllegalTransition that
    // D5 records and advances past — download happened, but the consumer does not wedge.
    await seed(validatingHistory([matchingCandidate('a')]));
    const selected = storedOfType('CandidateSelected');
    const ports = stubPorts({
      download: {
        download: vi.fn(() => okAsync({ kind: 'completed' as const, files: sampleFiles })),
        abort: vi.fn(() => okAsync([])),
      },
    });
    await reactor(ports).process(selected);
    expect(ports.download.download).toHaveBeenCalledOnce();
    expect(checkpoints.peek(REACTOR_CONSUMER)).toBe(selected.globalSeq);
  });
});
