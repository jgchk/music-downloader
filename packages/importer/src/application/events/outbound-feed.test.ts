import { err, ok } from 'neverthrow';
import { beforeEach, describe, expect, it } from 'vitest';
import type { ImportEvent } from '../../domain/import/events.js';
import {
  DELIVERED_CANDIDATE,
  SOURCE,
  awaitingReviewWithCandidate,
  resolved,
} from '../../domain/import/__fixtures__/import-fixtures.js';
import { FakeEventStore } from '../__fixtures__/fakes.js';
import type { StoredEvent } from '../ports/event-store-port.js';
import type { PublishedEventMapping } from '../ports/published-events-port.js';
import { OutboundFeed } from './outbound-feed.js';

/** A history whose last event is the published `ReleaseVerdictRecorded` fact. */
function verdictHistory(): ImportEvent[] {
  return [
    ...awaitingReviewWithCandidate(),
    resolved({ kind: 'reject-unusable-delivery', reasons: ['corrupt rip'] }),
    {
      type: 'ReleaseVerdictRecorded',
      acquisitionId: SOURCE.acquisitionId,
      candidate: DELIVERED_CANDIDATE,
      reasons: ['corrupt rip'],
    },
  ];
}

const mapping: PublishedEventMapping = {
  publishes: (type) => type === 'ReleaseVerdictRecorded',
  render: (stored: StoredEvent, prefix: readonly StoredEvent[]) =>
    ok({
      type: 'release.verdict',
      timestamp: stored.metadata.occurredAt,
      data: { streamId: stored.streamId, prefixLength: prefix.length },
    }),
};

let store: FakeEventStore;

beforeEach(() => {
  store = new FakeEventStore();
});

async function seed(streamId: string): Promise<void> {
  await store.append(streamId, 0, verdictHistory(), { importId: streamId, occurredAt: 'T0' });
}

describe('OutboundFeed', () => {
  it('renders only published events, identified by their global position', async () => {
    await seed('imp-1');
    const feed = new OutboundFeed(store, mapping);

    const readResult = await feed.read(0, 100);
    const batch = readResult._unsafeUnwrap();

    expect(batch.events).toHaveLength(1);
    expect(batch.events[0]).toMatchObject({
      type: 'release.verdict',
      timestamp: 'T0',
      data: { streamId: 'imp-1', prefixLength: verdictHistory().length },
    });
    expect(batch.events[0]!.globalSeq).toBe(batch.scannedTo);
  });

  it('bounds the scan to `limit` stored events and reports the scan boundary', async () => {
    await seed('imp-1');
    const feed = new OutboundFeed(store, mapping);

    const readResult2 = await feed.read(0, 2);
    const batch = readResult2._unsafeUnwrap();

    expect(batch.events).toHaveLength(0);
    expect(batch.scannedTo).toBe(2);
  });

  it('advances the scan boundary past trailing unpublished events', async () => {
    await seed('imp-1');
    const feed = new OutboundFeed(store, mapping);
    const readResult3 = await feed.read(0, 100);
    const full = readResult3._unsafeUnwrap();

    const readResult4 = await feed.read(full.events[0]!.globalSeq, 100);
    const tail = readResult4._unsafeUnwrap();

    expect(tail.events).toHaveLength(0);
    expect(tail.scannedTo).toBe(full.events[0]!.globalSeq);
  });

  it('renders a published event against only the prefix as of it, excluding later trailing events', async () => {
    // The published verdict is NOT the last event in its stream: a later ImportRejected follows it.
    await store.append(
      'imp-2',
      0,
      [...verdictHistory(), { type: 'ImportRejected', reason: 'gone', filesDeleted: true }],
      { importId: 'imp-2', occurredAt: 'T0' },
    );
    const feed = new OutboundFeed(store, mapping);

    const trailingResult = await feed.read(0, 100);
    const batch = trailingResult._unsafeUnwrap();

    expect(batch.events).toHaveLength(1);
    // The prefix stops at the verdict (`version <= stored.version`): the trailing event is excluded,
    // so the rendered prefix length is the history up to and including the verdict, not the whole stream.
    expect(batch.events[0]!.data).toEqual({
      streamId: 'imp-2',
      prefixLength: verdictHistory().length,
    });
  });

  it('surfaces store read failures instead of exposing partial results', async () => {
    await seed('imp-1');
    store.failReadAll = true;
    const feed = new OutboundFeed(store, mapping);

    const readResult5 = await feed.read(0, 100);
    expect(readResult5.isErr()).toBe(true);

    store.failReadAll = false;
    store.failReads = true;
    const readResult6 = await feed.read(0, 100);
    expect(readResult6.isErr()).toBe(true);
  });

  it('never exposes a payload that fails outbound validation', async () => {
    await seed('imp-1');
    const broken: PublishedEventMapping = {
      publishes: mapping.publishes,
      render: () =>
        err({ kind: 'RenderError', eventType: 'release.verdict', message: 'bad payload' }),
    };
    const feed = new OutboundFeed(store, broken);

    const batch = await feed.read(0, 100);

    expect(batch._unsafeUnwrapErr()).toMatchObject({ kind: 'RenderError' });
  });
});
