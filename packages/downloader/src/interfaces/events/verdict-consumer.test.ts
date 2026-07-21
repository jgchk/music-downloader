import { describe, expect, it } from 'vitest';
import type { SeamEvent } from '../../application/events/catch-up-subscription.js';
import {
  fulfilledHistory,
  matchingCandidate,
} from '../../domain/acquisition/__fixtures__/acquisition-fixtures.js';
import { testWiring } from '../__fixtures__/wiring.js';
import type { TestWiring } from '../__fixtures__/wiring.js';
import { verdictEventConsumer } from './verdict-consumer.js';

const a = matchingCandidate('a');
const b = matchingCandidate('b');

function verdictEvent(overrides: { data?: unknown; type?: string } = {}): SeamEvent {
  return {
    globalSeq: 1,
    type: overrides.type ?? 'release.verdict',
    timestamp: '2026-07-21T12:00:00.000Z',
    data: overrides.data ?? {
      acquisitionId: 'acq-9',
      candidate: { username: a.identity.username, path: a.identity.path, sizeBytes: 1000 },
      verdict: 'rejected',
      reasons: ['corrupt stub'],
      matchDistance: 0.42, // unknown fields are ignored — tolerant reader
    },
  };
}

async function fulfilledWiring(): Promise<TestWiring> {
  const wiring = testWiring();
  await wiring.store.append('acq-9', 0, fulfilledHistory([a, b]), {
    acquisitionId: 'acq-9',
    occurredAt: 't',
  });
  wiring.sync();
  return wiring;
}

describe('the verdict event consumer', () => {
  it('revives a fulfilled acquisition from a rejection verdict', async () => {
    const wiring = await fulfilledWiring();
    const consume = verdictEventConsumer(wiring.deps);

    const outcome = await consume(verdictEvent());

    expect(outcome.isOk()).toBe(true);
    wiring.sync();
    const stream = (await wiring.store.readStream('acq-9'))._unsafeUnwrap();
    // The verdict records the rejection and revives the retry ladder behind it.
    const types = stream.map((entry) => entry.type);
    expect(types).toContain('FulfillmentRejected');
    expect(types.at(-1)).toBe('CandidateSelected');
  });

  it('acknowledges and ignores events of other types', async () => {
    const wiring = await fulfilledWiring();
    const consume = verdictEventConsumer(wiring.deps);

    const outcome = await consume(verdictEvent({ type: 'import.applied' }));

    expect(outcome.isOk()).toBe(true);
    const stream = (await wiring.store.readStream('acq-9'))._unsafeUnwrap();
    expect(stream.map((entry) => entry.type)).not.toContain('FulfillmentRejected');
  });

  it('a redelivered verdict converges to a no-op', async () => {
    const wiring = await fulfilledWiring();
    const consume = verdictEventConsumer(wiring.deps);

    await consume(verdictEvent());
    const before = (await wiring.store.readStream('acq-9'))._unsafeUnwrap().length;
    const again = await consume(verdictEvent());

    expect(again.isOk()).toBe(true);
    const after = (await wiring.store.readStream('acq-9'))._unsafeUnwrap().length;
    expect(after).toBe(before);
  });

  it('a malformed payload of the known type is a permanent (poison) failure', async () => {
    const wiring = await fulfilledWiring();
    const consume = verdictEventConsumer(wiring.deps);

    const outcome = await consume(verdictEvent({ data: { verdict: 'rejected' } }));

    expect(outcome._unsafeUnwrapErr()).toEqual({ kind: 'Permanent', reason: 'InvalidPayload' });
  });

  it('an infra fault is transient — the seam redelivers', async () => {
    const wiring = await fulfilledWiring();
    wiring.store.failReads = true;
    const consume = verdictEventConsumer(wiring.deps);

    const outcome = await consume(verdictEvent());

    expect(outcome._unsafeUnwrapErr().kind).toBe('Transient');
  });
});
