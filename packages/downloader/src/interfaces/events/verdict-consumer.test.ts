import { fixedClock } from '../../application/__fixtures__/fakes.js';
import { appendMetadata } from '../../application/__fixtures__/correlation.js';
import { describe, expect, it } from 'vitest';
import type { SeamEvent } from '../../application/events/catch-up-subscription.js';
import {
  fulfilledHistory,
  matchingCandidate,
} from '../../domain/acquisition/__fixtures__/acquisition-fixtures.js';
import { testWiring } from '../../facade/__fixtures__/wiring.js';
import type { TestWiring } from '../../facade/__fixtures__/wiring.js';
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
  await wiring.store.append(
    'acq-9',
    0,
    fulfilledHistory([a, b]),
    appendMetadata('acq-9', fixedClock()),
  );
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
    const readStreamResult = await wiring.store.readStream('acq-9');
    const stream = readStreamResult._unsafeUnwrap();
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
    const readStreamResult2 = await wiring.store.readStream('acq-9');
    const stream = readStreamResult2._unsafeUnwrap();
    expect(stream.map((entry) => entry.type)).not.toContain('FulfillmentRejected');
  });

  it('a redelivered verdict converges to a no-op', async () => {
    const wiring = await fulfilledWiring();
    const consume = verdictEventConsumer(wiring.deps);

    await consume(verdictEvent());
    const readStreamResult3 = await wiring.store.readStream('acq-9');
    const before = readStreamResult3._unsafeUnwrap().length;
    const again = await consume(verdictEvent());

    expect(again.isOk()).toBe(true);
    const readStreamResult4 = await wiring.store.readStream('acq-9');
    const after = readStreamResult4._unsafeUnwrap().length;
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

describe('verdict consumer — crossing the seam', () => {
  const IMPORTER_STORY = '00112233445566778899aabbccddeeff';

  it('adopts the producer story and points causation at the consumed event', async () => {
    const wiring = await fulfilledWiring();
    const before = wiring.store.all().length;
    const event: SeamEvent = {
      ...verdictEvent(),
      metadata: {
        correlationId: IMPORTER_STORY,
        causation: { kind: 'event', context: 'importer', streamId: 'imp-7', version: 4 },
      },
    };

    const outcome = await verdictEventConsumer(wiring.deps)(event);

    expect(outcome.isOk()).toBe(true);
    const appended = wiring.store.all().filter((entry) => entry.globalSeq > before);
    expect(appended.length).toBeGreaterThan(0);
    for (const entry of appended) {
      // Verbatim: re-minting here would defeat the one promise this capability exists to keep.
      expect(entry.metadata.correlationId).toBe(IMPORTER_STORY);
      expect(entry.metadata.causation).toEqual({
        kind: 'event',
        context: 'importer',
        streamId: 'imp-7',
        version: 4,
      });
    }
  });

  it('consumes an event with no metadata block unchanged, on a freshly minted story', async () => {
    const wiring = await fulfilledWiring();
    const before = wiring.store.all().length;

    const outcome = await verdictEventConsumer(wiring.deps)(verdictEvent());

    expect(outcome.isOk()).toBe(true); // absence degrades the trace, never the work
    const appended = wiring.store.all().filter((entry) => entry.globalSeq > before);
    expect(appended.length).toBeGreaterThan(0);
    expect(appended[0]!.metadata.correlationId).toMatch(/^[0-9a-f]{32}$/);
    expect(appended[0]!.metadata.correlationId).not.toBe(IMPORTER_STORY);
  });

  it('mints fresh rather than trusting a malformed metadata block', async () => {
    const wiring = await fulfilledWiring();
    const before = wiring.store.all().length;
    const event: SeamEvent = { ...verdictEvent(), metadata: { correlationId: 'not-a-trace-id' } };

    const outcome = await verdictEventConsumer(wiring.deps)(event);

    expect(outcome.isOk()).toBe(true);
    const appended = wiring.store.all().find((entry) => entry.globalSeq > before);
    expect(appended?.metadata.correlationId).toMatch(/^[0-9a-f]{32}$/);
  });
});
