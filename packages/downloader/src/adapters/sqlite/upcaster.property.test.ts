import fc from 'fast-check';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { assertAsyncProperty } from '../../__fixtures__/property.js';
import type { EventMetadata } from '../../application/ports/event-store-port.js';
import { Acquisition } from '../../domain/acquisition/acquisition.js';
import type { AcquisitionEvent } from '../../domain/acquisition/events.js';
import {
  defaultPolicies,
  sampleGroupRequest,
} from '../../domain/acquisition/__fixtures__/acquisition-fixtures.js';
import { arbEvent } from '../../domain/acquisition/__fixtures__/arbitraries.js';
import { SqliteEventStore } from './event-store.js';
import { openEventDatabase } from './schema.js';
import type { EventDatabase } from './schema.js';
import { buildUpcasterRegistry } from './upcaster.js';

/**
 * Upcaster round-trips as a codec property (decider-properties D2). The example tests next door
 * pin the two v1 payloads someone thought to write down; this pins the *contract* against generated
 * v1 shapes, and it does so through the production path — the real `SqliteEventStore`, its
 * JSON encode/decode, and the real `buildUpcasterRegistry()` — rather than by calling the upcaster
 * function directly, because the seam that can rot is the wiring between them.
 */

const META: EventMetadata = { acquisitionId: 'acq', occurredAt: '2026-08-06T00:00:00.000Z' };

/**
 * A v1 `ManualSelectionRequested` payload as it sat on disk before `EditionCandidate.trackCount`
 * became optional: an unknown count was written as the sentinel `0`. Generated as a raw record,
 * not as a domain value — a legacy wire shape is precisely what the current types no longer admit.
 */
const arbLegacyEditionMenu = fc.array(
  fc.record(
    {
      releaseMbid: fc.constantFrom('rel-1', 'rel-2', 'rel-3'),
      title: fc.constantFrom('Repeater', 'Repeater + 3 Songs'),
      date: fc.constantFrom('1990-04-19', '1990'),
      country: fc.constantFrom('US', 'GB'),
      format: fc.constantFrom('CD', '12" Vinyl'),
      trackCount: fc.integer({ min: 0, max: 14 }), // 0 is the legacy "unknown" sentinel
    },
    { requiredKeys: ['releaseMbid'] },
  ),
  { minLength: 1, maxLength: 4 },
);

describe('legacy history upcasts to v2 semantics through the real store', () => {
  let database: EventDatabase;
  let store: SqliteEventStore;
  let streams = 0;

  beforeEach(() => {
    database = openEventDatabase(':memory:');
    store = new SqliteEventStore(database, buildUpcasterRegistry());
    streams = 0;
  });

  afterEach(() => {
    if (database.open) database.close();
  });

  /** Write a payload straight to the events table at a chosen schema version, as a legacy writer did. */
  function writeLegacyRow(
    streamId: string,
    version: number,
    type: string,
    data: Record<string, unknown>,
  ): void {
    database
      .prepare(
        `INSERT INTO events (stream_id, version, type, schema_version, data, metadata)
         VALUES (?, ?, ?, ?, ?, ?)`,
      )
      .run(streamId, version, type, 1, JSON.stringify(data), JSON.stringify(META));
  }

  it('folds every unknown track count to absent and leaves every known one alone', async () => {
    await assertAsyncProperty(
      fc.asyncProperty(arbLegacyEditionMenu, async (legacyCandidates) => {
        const streamId = `acq-${String((streams += 1))}`;
        writeLegacyRow(streamId, 0, 'ManualSelectionRequested', {
          type: 'ManualSelectionRequested',
          candidates: legacyCandidates,
        });

        const read = await store.readStream(streamId);
        const stored = read._unsafeUnwrap();

        const [event] = stored;
        expect(event?.event.type).toBe('ManualSelectionRequested');
        const upcasted =
          event?.event.type === 'ManualSelectionRequested' ? event.event.candidates : [];

        expect(upcasted).toHaveLength(legacyCandidates.length);
        for (const [index, candidate] of upcasted.entries()) {
          const legacy = legacyCandidates[index]!;
          // v2's semantics: absent means unknown. The sentinel must not survive as a real count.
          expect(candidate.trackCount).toBe(
            legacy.trackCount === 0 ? undefined : legacy.trackCount,
          );
          // Everything the rename did not touch is carried through byte-for-byte.
          expect({ ...candidate, trackCount: legacy.trackCount }).toEqual(legacy);
        }
      }),
    );
  });

  it('leaves the upcasted menu foldable — the aggregate never sees a v1 shape', async () => {
    await assertAsyncProperty(
      fc.asyncProperty(arbLegacyEditionMenu, async (legacyCandidates) => {
        const streamId = `acq-${String((streams += 1))}`;
        const opening: AcquisitionEvent = {
          type: 'AcquisitionRequested',
          request: sampleGroupRequest,
          policies: defaultPolicies(),
        };
        const requested = await store.append(streamId, 0, [opening], META);
        expect(requested.isOk()).toBe(true);
        writeLegacyRow(streamId, 1, 'ManualSelectionRequested', {
          type: 'ManualSelectionRequested',
          candidates: legacyCandidates,
        });

        const read = await store.readStream(streamId);
        const stored = read._unsafeUnwrap();
        const acquisition = Acquisition.fromHistory(stored.map((row) => row.event));

        expect(acquisition.phase).toBe('AwaitingManualSelection');
        expect(acquisition.snapshot.candidates?.map((candidate) => candidate.trackCount)).toEqual(
          legacyCandidates.map((candidate) =>
            candidate.trackCount === 0 ? undefined : candidate.trackCount,
          ),
        );
      }),
    );
  });

  it('passes a legacy row of any unregistered type through untouched', async () => {
    await assertAsyncProperty(
      fc.asyncProperty(arbEvent, async (event) => {
        fc.pre(event.type !== 'ManualSelectionRequested'); // the one type with a step registered
        const streamId = `acq-${String((streams += 1))}`;
        writeLegacyRow(streamId, 0, event.type, structuredClone(event));

        const read = await store.readStream(streamId);
        const stored = read._unsafeUnwrap();

        expect(stored[0]?.event).toEqual(event);
      }),
    );
  });
});

describe('an event written today reads back as itself', () => {
  let database: EventDatabase;
  let store: SqliteEventStore;
  let streams = 0;

  beforeEach(() => {
    database = openEventDatabase(':memory:');
    store = new SqliteEventStore(database, buildUpcasterRegistry());
    streams = 0;
  });

  afterEach(() => {
    if (database.open) database.close();
  });

  it('round-trips any current-version event through the store codec losslessly', async () => {
    await assertAsyncProperty(
      fc.asyncProperty(fc.array(arbEvent, { minLength: 1, maxLength: 5 }), async (events) => {
        const streamId = `acq-${String((streams += 1))}`;

        const appended = await store.append(streamId, 0, events, META);
        const read = await store.readStream(streamId);
        const stored = read._unsafeUnwrap();

        expect(appended.isOk()).toBe(true);
        // Today's writes are stamped current, so no upcaster step ever runs against them and the
        // only transform in play is the store's own JSON encode/decode.
        expect(stored.map((row) => row.event)).toEqual(events);
        expect(stored.map((row) => row.version)).toEqual(events.map((_event, index) => index));
      }),
    );
  });
});
