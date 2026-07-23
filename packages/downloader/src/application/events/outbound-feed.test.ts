import { err, ok } from 'neverthrow';
import { beforeEach, describe, expect, it } from 'vitest';
import type { AcquisitionEvent } from '../../domain/acquisition/events.js';
import {
  importingHistory,
  matchingCandidate,
  sampleFiles,
} from '../../domain/acquisition/__fixtures__/acquisition-fixtures.js';
import { FakeEventStore } from '../__fixtures__/fakes.js';
import type { StoredEvent } from '../ports/event-store-port.js';
import type { PublishedEventMapping } from '../ports/published-events-port.js';
import { OutboundFeed } from './outbound-feed.js';

function fulfilled(): AcquisitionEvent[] {
  const candidate = matchingCandidate('peer');
  return [
    ...importingHistory([candidate]),
    { type: 'Imported', candidate: candidate.identity, location: '/lib/kid-a', files: sampleFiles },
    { type: 'AcquisitionFulfilled', location: '/lib/kid-a' },
  ];
}

const mapping: PublishedEventMapping = {
  publishes: (type) => type === 'AcquisitionFulfilled',
  render: (stored: StoredEvent, prefix: readonly StoredEvent[]) =>
    ok({
      type: 'acquisition.fulfilled',
      timestamp: stored.metadata.occurredAt,
      data: { streamId: stored.streamId, prefixLength: prefix.length },
    }),
};

let store: FakeEventStore;

beforeEach(() => {
  store = new FakeEventStore();
});

async function seed(streamId: string): Promise<void> {
  await store.append(streamId, 0, fulfilled(), { acquisitionId: streamId, occurredAt: 'T0' });
}

describe('OutboundFeed', () => {
  it('renders only published events, identified by their global position', async () => {
    await seed('acq-1');
    const feed = new OutboundFeed(store, mapping);

    const batch = await feed.read(0, 100);

    expect(batch.isOk()).toBe(true);
    const { events, scannedTo } = batch._unsafeUnwrap();
    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({
      type: 'acquisition.fulfilled',
      timestamp: 'T0',
      data: { streamId: 'acq-1' },
    });
    // The fulfilment is the last stored event, so its position equals the scan boundary.
    expect(events[0]!.globalSeq).toBe(scannedTo);
  });

  it('renders from the stream prefix as of the event — deterministic across replays', async () => {
    await seed('acq-1');
    const feed = new OutboundFeed(store, mapping);

    const readResult = await feed.read(0, 100);
    const first = readResult._unsafeUnwrap();
    const readResult2 = await feed.read(0, 100);
    const again = readResult2._unsafeUnwrap();

    expect(again).toStrictEqual(first);
    const prefixLength = (first.events[0]!.data as { prefixLength: number }).prefixLength;
    expect(prefixLength).toBe(fulfilled().length);
  });

  it('bounds the scan to `limit` stored events and reports the scan boundary', async () => {
    await seed('acq-1');
    const feed = new OutboundFeed(store, mapping);

    // A batch smaller than the history scans only unpublished rows: no events, cursor advances.
    const readResult3 = await feed.read(0, 2);
    const batch = readResult3._unsafeUnwrap();

    expect(batch.events).toHaveLength(0);
    expect(batch.scannedTo).toBe(2);
  });

  it('advances the scan boundary past trailing unpublished events', async () => {
    await seed('acq-1');
    const feed = new OutboundFeed(store, mapping);
    const readResult4 = await feed.read(0, 100);
    const full = readResult4._unsafeUnwrap();

    // Reading from the published event's position scans the (empty) tail without re-rendering.
    const readResult5 = await feed.read(full.events[0]!.globalSeq, 100);
    const tail = readResult5._unsafeUnwrap();

    expect(tail.events).toHaveLength(0);
    expect(tail.scannedTo).toBe(full.events[0]!.globalSeq);
  });

  it('surfaces a store read failure instead of exposing partial results', async () => {
    await seed('acq-1');
    store.failReadAll = true;
    const feed = new OutboundFeed(store, mapping);

    const batch = await feed.read(0, 100);

    expect(batch.isErr()).toBe(true);
  });

  it('surfaces a stream read failure while rendering', async () => {
    await seed('acq-1');
    store.failReads = true;
    const feed = new OutboundFeed(store, mapping);

    const batch = await feed.read(0, 100);

    expect(batch.isErr()).toBe(true);
  });

  it('never exposes a payload that fails outbound validation', async () => {
    await seed('acq-1');
    const broken: PublishedEventMapping = {
      publishes: mapping.publishes,
      render: () =>
        err({ kind: 'RenderError', eventType: 'acquisition.fulfilled', message: 'bad payload' }),
    };
    const feed = new OutboundFeed(store, broken);

    const batch = await feed.read(0, 100);

    expect(batch.isErr()).toBe(true);
    expect(batch._unsafeUnwrapErr()).toMatchObject({ kind: 'RenderError' });
  });
});
