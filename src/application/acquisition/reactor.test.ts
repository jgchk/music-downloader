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
import type { StoredEvent } from '../ports/event-store-port.js';
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

function storedOfType(type: AcquisitionEvent['type']): StoredEvent {
  const found = store.all().find((entry) => entry.type === type);
  if (found === undefined) throw new Error(`no stored event of type ${type}`);
  return found;
}

const importedThenFulfilled = (cands: readonly ReturnType<typeof matchingCandidate>[]) => [
  ...importingHistory(cands),
  { type: 'Imported' as const, candidate: cands[0]!.identity, location: '/lib/kid-a' },
  { type: 'AcquisitionFulfilled' as const, location: '/lib/kid-a' },
];

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

  it('does not advance the checkpoint when an effect dispatch fails with an infra fault', async () => {
    await seed(requestedHistory());
    const event = store.all()[0]!;
    const ports = stubPorts({
      metadata: { resolve: vi.fn(() => errAsync(infraError('mb', 'down'))) },
    });
    await reactor(ports).process(event);
    expect(checkpoints.peek(REACTOR_CONSUMER)).toBeUndefined();
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
    expect(ports.library.discardStaging).toHaveBeenCalledWith(matchingCandidate('a').identity);
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
      },
    });
    await reactor(ports).process(selected);
    expect(ports.download.download).toHaveBeenCalledOnce();
    expect(checkpoints.peek(REACTOR_CONSUMER)).toBe(selected.globalSeq);
  });
});
