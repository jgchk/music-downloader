import { fixedClock } from '../../application/__fixtures__/fakes.js';
import { appendMetadata } from '../../application/__fixtures__/correlation.js';
import { beforeEach, describe, expect, it } from 'vitest';
import type { SeamEvent } from '../../application/events/catch-up-subscription.js';
import {
  fulfilledHistory,
  matchingCandidate,
} from '../../domain/download/__fixtures__/download-fixtures.js';
import { testWiring } from '../../facade/__fixtures__/wiring.js';
import type { TestWiring } from '../../facade/__fixtures__/wiring.js';
import { verdictEventConsumer } from './verdict-consumer.js';

/**
 * Captures the one thing this consumer can silently get wrong: an unreadable envelope.
 *
 * Module-scope and therefore shared, so it is emptied before EVERY scenario rather than by hand in
 * the ones that happen to assert on it. Resetting per test was the previous arrangement and it is
 * the erratic-test shape: a scenario that forgot the reset read another scenario's warnings, and a
 * scenario that expected silence passed only because whoever ran before it happened to be quiet.
 */
const unreadable: { context: Record<string, unknown>; message: string }[] = [];
const warned = (context: Record<string, unknown>, message: string): void => {
  unreadable.push({ context, message });
};

beforeEach(() => {
  unreadable.length = 0;
});

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
  it('revives a fulfilled download from a rejection verdict', async () => {
    const wiring = await fulfilledWiring();
    const consume = verdictEventConsumer(wiring.deps, { warn: warned });

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
    const consume = verdictEventConsumer(wiring.deps, { warn: warned });

    const outcome = await consume(verdictEvent({ type: 'import.applied' }));

    expect(outcome.isOk()).toBe(true);
    const readStreamResult2 = await wiring.store.readStream('acq-9');
    const stream = readStreamResult2._unsafeUnwrap();
    expect(stream.map((entry) => entry.type)).not.toContain('FulfillmentRejected');
  });

  it('a redelivered verdict converges to a no-op', async () => {
    const wiring = await fulfilledWiring();
    const consume = verdictEventConsumer(wiring.deps, { warn: warned });

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
    const consume = verdictEventConsumer(wiring.deps, { warn: warned });

    const outcome = await consume(verdictEvent({ data: { verdict: 'rejected' } }));

    // The classification HALTS the seam, so the failure it returns is the operator's whole account
    // of why: `InvalidPayload` alone names no field, and the zod issues are the only thing that does.
    const failure = outcome._unsafeUnwrapErr();
    expect(failure).toMatchObject({ kind: 'Permanent', reason: 'InvalidPayload' });
    expect(failure.cause).toMatchObject({ eventType: 'release.verdict', globalSeq: 1 });
    expect(JSON.stringify(failure.cause)).toContain('verdict');
  });

  it('an infra fault is transient — the seam redelivers', async () => {
    const wiring = await fulfilledWiring();
    wiring.store.failReads = true;
    const consume = verdictEventConsumer(wiring.deps, { warn: warned });

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

    const outcome = await verdictEventConsumer(wiring.deps, { warn: warned })(event);

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

    const outcome = await verdictEventConsumer(wiring.deps, { warn: warned })(verdictEvent());

    expect(outcome.isOk()).toBe(true); // absence degrades the trace, never the work
    const appended = wiring.store.all().filter((entry) => entry.globalSeq > before);
    expect(appended.length).toBeGreaterThan(0);
    expect(appended[0]!.metadata.correlationId).toMatch(/^[0-9a-f]{32}$/);
    expect(appended[0]!.metadata.correlationId).not.toBe(IMPORTER_STORY);
  });

  it('announces an envelope it cannot read — that is producer drift, not history', async () => {
    const wiring = await fulfilledWiring();
    const event: SeamEvent = { ...verdictEvent(), metadata: { correlationId: 'not-a-trace-id' } };

    await verdictEventConsumer(wiring.deps, { warn: warned })(event);

    expect(unreadable).toHaveLength(1);
    expect(unreadable[0]!.message).toContain('cannot read');
    // Which delivery drifted: an alert that cannot be traced back to a producer event and the
    // envelope it sent is one an operator can only shrug at.
    expect(unreadable[0]!.context).toMatchObject({ acquisitionId: 'acq-9', globalSeq: 1 });
    // And which FIELD drifted — the detail is the parse error, and naming the offending field is
    // the whole of its value to the reader. Asserting only that it is a string would be satisfied
    // by the empty one.
    expect(unreadable[0]!.context.detail).toContain('correlationId');
  });

  it('stays quiet when a producer simply sends no envelope — permanent and expected', async () => {
    const wiring = await fulfilledWiring();

    await verdictEventConsumer(wiring.deps, { warn: warned })(verdictEvent());

    expect(unreadable).toEqual([]);
  });

  it('reads an explicitly null envelope as no envelope at all — also quiet', async () => {
    // A producer that serializes an absent block as `null` has sent no block, not a broken one:
    // announcing it would blunt the one warning that means a LIVE producer has drifted.
    const wiring = await fulfilledWiring();
    const before = wiring.store.all().length;
    const event: SeamEvent = { ...verdictEvent(), metadata: null };

    const outcome = await verdictEventConsumer(wiring.deps, { warn: warned })(event);

    expect(outcome.isOk()).toBe(true);
    expect(unreadable).toEqual([]);
    const appended = wiring.store.all().find((entry) => entry.globalSeq > before);
    expect(appended?.metadata.correlationId).toMatch(/^[0-9a-f]{32}$/);
  });

  it('mints fresh rather than trusting a malformed metadata block', async () => {
    const wiring = await fulfilledWiring();
    const before = wiring.store.all().length;
    const event: SeamEvent = { ...verdictEvent(), metadata: { correlationId: 'not-a-trace-id' } };

    const outcome = await verdictEventConsumer(wiring.deps, { warn: warned })(event);

    expect(outcome.isOk()).toBe(true);
    const appended = wiring.store.all().find((entry) => entry.globalSeq > before);
    expect(appended?.metadata.correlationId).toMatch(/^[0-9a-f]{32}$/);
  });
});
