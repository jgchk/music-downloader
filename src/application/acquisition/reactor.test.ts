import { errAsync, okAsync } from 'neverthrow';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { REACTOR_CONSUMER, Reactor } from './reactor.js';
import type { ReactorDeps } from './reactor.js';
import type { EffectPorts, InterpreterDeps } from './interpreter.js';
import {
  FakeCheckpointStore,
  FakeEventBus,
  FakeEventStore,
  fixedClock,
  silentLogger,
} from '../__fixtures__/fakes.js';
import { infraError } from '../ports/errors.js';
import type { AcquisitionEvent } from '../../domain/acquisition/events.js';
import {
  matchingCandidate,
  requestedHistory,
  resolvedHistory,
  sampleTarget,
  selectedHistory,
} from '../../domain/acquisition/__fixtures__/acquisition-fixtures.js';

function stubPorts(overrides: Partial<EffectPorts> = {}): EffectPorts {
  return {
    metadata: {
      resolve: vi.fn(() => okAsync({ kind: 'resolved' as const, target: sampleTarget })),
    },
    search: { search: vi.fn(() => okAsync([])) },
    download: {
      download: vi.fn(() => okAsync({ kind: 'failed' as const, reason: 'Stalled' as const })),
    },
    probe: { probe: vi.fn() },
    library: { import: vi.fn(), discardStaging: vi.fn(() => okAsync(undefined)) },
    ...overrides,
  };
}

let store: FakeEventStore;
let checkpoints: FakeCheckpointStore;
let bus: FakeEventBus;

function interpreter(ports: EffectPorts): InterpreterDeps {
  return { store, clock: fixedClock(), ports, onProgress: vi.fn() };
}

function reactor(ports: EffectPorts): Reactor {
  const deps: ReactorDeps = {
    store,
    checkpoints,
    bus,
    logger: silentLogger(),
    interpreter: interpreter(ports),
  };
  return new Reactor(deps);
}

async function seed(history: readonly AcquisitionEvent[]): Promise<void> {
  await store.append('acq-1', 0, history, { acquisitionId: 'acq-1', occurredAt: 't' });
}

beforeEach(() => {
  store = new FakeEventStore();
  checkpoints = new FakeCheckpointStore();
  bus = new FakeEventBus();
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

  it('does not advance the checkpoint when an effect dispatch fails', async () => {
    await seed(requestedHistory());
    const event = store.all()[0]!;
    const ports = stubPorts({
      metadata: { resolve: vi.fn(() => errAsync(infraError('mb', 'down'))) },
    });
    await reactor(ports).process(event);
    expect(checkpoints.peek(REACTOR_CONSUMER)).toBeUndefined();
  });
});
