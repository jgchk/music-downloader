import fc from 'fast-check';
import { appendMetadata } from '../../application/__fixtures__/correlation.js';
import { describe, expect, it } from 'vitest';
import { assertAsyncProperty } from '../../__fixtures__/property.js';
import type { AppendMetadata } from '../../application/ports/event-store-port.js';
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
 * Upcaster round-trips as a codec property (decider-properties D2), through the production path:
 * the real `SqliteEventStore`, its JSON encode/decode, and the real `buildUpcasterRegistry()` —
 * rather than by calling the upcaster function directly, because the seam that rots is the wiring
 * between them.
 *
 * **These do not replace the frozen v1 fixtures** under `test/contract/fixtures/events/`. A
 * generated shape is not a recorded one: the fixtures are evidence of what a real writer actually
 * put on disk, and only they can catch a v1 field this file's generator never thought to emit. The
 * two are complementary, and neither makes the other redundant.
 */

const META: AppendMetadata = appendMetadata('acq', '2026-08-06T00:00:00.000Z');

/**
 * A v1 `ManualSelectionRequested` payload as it sat on disk before `EditionCandidate.trackCount`
 * became optional: an unknown count was written as the sentinel `0`. Generated as a raw record, not
 * as a domain value — a legacy wire shape is precisely what the current types no longer admit.
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

/**
 * Each property run gets its OWN in-memory database, opened inside the predicate.
 *
 * Sharing one database across a sweep would leave run N's rows visible to run N+1 and — worse —
 * would break the harness's central promise: replaying a reported `seed` + `path` re-runs only the
 * counterexample, so a shared database would hold different rows than it did when the failure
 * happened, and the counterexample might not reproduce. A fresh `:memory:` database costs
 * microseconds.
 */
async function withStore(
  use: (store: SqliteEventStore, database: EventDatabase) => Promise<void>,
): Promise<void> {
  const database = openEventDatabase(':memory:');
  try {
    await use(new SqliteEventStore(database, buildUpcasterRegistry()), database);
  } finally {
    if (database.open) database.close();
  }
}

/** Write a payload straight to the events table at schema version 1, as a legacy writer did. */
function writeLegacyRow(
  database: EventDatabase,
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

describe('legacy history upcasts to v2 semantics through the real store', () => {
  it('folds every unknown track count to absent and leaves every known one alone', async () => {
    await assertAsyncProperty(
      fc.asyncProperty(arbLegacyEditionMenu, async (legacyCandidates) => {
        await withStore(async (store, database) => {
          writeLegacyRow(database, 'acq-1', 0, 'ManualSelectionRequested', {
            type: 'ManualSelectionRequested',
            candidates: legacyCandidates,
          });

          const read = await store.readStream('acq-1');
          const stored = read._unsafeUnwrap();

          const event = stored[0]?.event;
          expect(event?.type).toBe('ManualSelectionRequested');
          const upcasted = event?.type === 'ManualSelectionRequested' ? event.candidates : [];

          expect(upcasted).toHaveLength(legacyCandidates.length);
          for (const [index, candidate] of upcasted.entries()) {
            const legacy = legacyCandidates[index]!;
            // v2's semantics: absent means unknown. The sentinel must not survive as a real count.
            expect(candidate.trackCount).toBe(
              legacy.trackCount === 0 ? undefined : legacy.trackCount,
            );
            // Everything the change did not touch is carried through byte-for-byte.
            expect({ ...candidate, trackCount: legacy.trackCount }).toEqual(legacy);
          }
        });
      }),
    );
  });

  it('leaves the upcasted menu foldable — the aggregate never sees a v1 shape', async () => {
    await assertAsyncProperty(
      fc.asyncProperty(arbLegacyEditionMenu, async (legacyCandidates) => {
        await withStore(async (store, database) => {
          const opening: AcquisitionEvent = {
            type: 'AcquisitionRequested',
            request: sampleGroupRequest,
            policies: defaultPolicies(),
          };
          const appended = await store.append('acq-1', 0, [opening], META);
          expect(appended.isOk()).toBe(true);
          writeLegacyRow(database, 'acq-1', 1, 'ManualSelectionRequested', {
            type: 'ManualSelectionRequested',
            candidates: legacyCandidates,
          });

          const read = await store.readStream('acq-1');
          const acquisition = Acquisition.fromHistory(read._unsafeUnwrap().map((row) => row.event));

          // The legacy row must reach a phase that actually *consumes* it: folding onto a state
          // that ignores the event would pass for any payload at all.
          expect(acquisition.phase).toBe('AwaitingManualSelection');
          expect(acquisition.snapshot.candidates?.map((candidate) => candidate.trackCount)).toEqual(
            legacyCandidates.map((candidate) =>
              candidate.trackCount === 0 ? undefined : candidate.trackCount,
            ),
          );
        });
      }),
    );
  });

  it('passes a row of any type with no registered step through untouched', async () => {
    await assertAsyncProperty(
      fc.asyncProperty(arbEvent, async (event) => {
        fc.pre(event.type !== 'ManualSelectionRequested'); // the one type with a step registered
        await withStore(async (store, database) => {
          writeLegacyRow(database, 'acq-1', 0, event.type, structuredClone(event));

          const read = await store.readStream('acq-1');

          expect(read._unsafeUnwrap()[0]?.event).toEqual(event);
        });
      }),
    );
  });
});

describe('an event written today reads back as itself', () => {
  it('round-trips any current-version event through the store codec losslessly', async () => {
    await assertAsyncProperty(
      fc.asyncProperty(fc.array(arbEvent, { minLength: 1, maxLength: 5 }), async (events) => {
        await withStore(async (store) => {
          const appended = await store.append('acq-1', 0, events, META);
          // Asserted before the read is unwrapped: an append failure must report as itself, not as
          // a confusing empty-array mismatch further down.
          expect(appended.isOk()).toBe(true);

          const read = await store.readStream('acq-1');
          const stored = read._unsafeUnwrap();

          // Today's writes are stamped current, so no upcaster step ever runs against them and the
          // only transform in play is the store's own JSON encode/decode.
          expect(stored.map((row) => row.event)).toEqual(events);
          expect(stored.map((row) => row.version)).toEqual(events.map((_event, index) => index));
        });
      }),
    );
  });
});
