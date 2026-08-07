import fc from 'fast-check';
import { appendMetadata } from '../../application/__fixtures__/correlation.js';
import { describe, expect, it } from 'vitest';
import { assertAsyncProperty } from '../../__fixtures__/property.js';
import type { AppendMetadata } from '../../application/ports/event-store-port.js';
import { Import } from '../../domain/import/import.js';
import { awaitingReviewWithCandidate } from '../../domain/import/__fixtures__/import-fixtures.js';
import { arbEvent } from '../../domain/import/__fixtures__/arbitraries.js';
import { LEGACY_REJECT_VERB } from './__fixtures__/legacy-review-resolved.js';
import { SqliteEventStore } from './event-store.js';
import { openEventDatabase } from './schema.js';
import type { EventDatabase } from './schema.js';
import { buildUpcasterRegistry } from './upcaster.js';

/**
 * Upcaster round-trips as a codec property (decider-properties D2, task 3.1), through the
 * production path: the real `SqliteEventStore`, its JSON encode/decode, and the real
 * `buildUpcasterRegistry()` — because the seam that rots is the wiring between them, not the
 * transform in isolation.
 *
 * **These do not replace the frozen v1 fixtures** under `test/contract/fixtures/events/`. A
 * generated shape is not a recorded one: only the fixtures are evidence of what a real writer put
 * on disk, and only they catch a v1 field this file's generator never thought to emit.
 */

const META: AppendMetadata = appendMetadata('imp', '2026-08-06T00:00:00.000Z');

/**
 * A v1 `ReviewResolved` payload: an earlier version stored the reject-a-bad-delivery verb under the
 * downloader's action name. Generated as a raw record — the current types no longer admit the token.
 */
const arbLegacyResolved = fc.oneof(
  fc.record(
    {
      kind: fc.constant(LEGACY_REJECT_VERB),
      reasons: fc.array(fc.constantFrom('corrupt rip', 'transcode'), { maxLength: 2 }),
    },
    { requiredKeys: ['kind'] },
  ),
  // Every other verb is not this rename's concern and must pass through byte-for-byte.
  fc.record({ kind: fc.constantFrom('reject', 'import-as-is', 'refresh-candidates') }),
);

/**
 * Each property run gets its OWN in-memory database, opened inside the predicate. Sharing one
 * across a sweep would leave run N's rows visible to run N+1 and would break replay: re-running a
 * reported `seed` + `path` executes only the counterexample, so a shared database would hold
 * different rows than it did when the failure happened.
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
  it('renames the legacy rejection verb forward and leaves every other verb alone', async () => {
    await assertAsyncProperty(
      fc.asyncProperty(arbLegacyResolved, async (legacyResolution) => {
        await withStore(async (store, database) => {
          writeLegacyRow(database, 'imp-1', 0, 'ReviewResolved', {
            type: 'ReviewResolved',
            resolution: legacyResolution,
          });

          const read = await store.readStream('imp-1');
          const event = read._unsafeUnwrap()[0]?.event;

          expect(event?.type).toBe('ReviewResolved');
          const resolution = event?.type === 'ReviewResolved' ? event.resolution : undefined;

          // The importer speaks its own language: the downloader's action name never reaches the
          // domain, and the reviewer's reasons survive the rename intact.
          expect(resolution?.kind).toBe(
            legacyResolution.kind === LEGACY_REJECT_VERB
              ? 'reject-unusable-delivery'
              : legacyResolution.kind,
          );
          expect({ ...resolution, kind: legacyResolution.kind }).toEqual(legacyResolution);
        });
      }),
    );
  });

  it('passes a row of any type with no registered step through untouched', async () => {
    await assertAsyncProperty(
      fc.asyncProperty(arbEvent, async (event) => {
        fc.pre(event.type !== 'ReviewResolved'); // the one type with a step registered
        await withStore(async (store, database) => {
          writeLegacyRow(database, 'imp-1', 0, event.type, structuredClone(event));

          const read = await store.readStream('imp-1');

          expect(read._unsafeUnwrap()[0]?.event).toEqual(event);
        });
      }),
    );
  });

  it('settles an open review with the renamed verb — the ACL’s actual job', async () => {
    await assertAsyncProperty(
      fc.asyncProperty(
        fc.array(fc.constantFrom('corrupt rip', 'transcode'), { maxLength: 2 }),
        async (reasons) => {
          await withStore(async (store, database) => {
            // The legacy row has to land on a state that CONSUMES it. Folded onto an empty stream
            // a `ReviewResolved` is ignored, so such a test passes for any garbage verb — including
            // one the upcaster failed to rename. An open review is where the verb actually decides
            // something, and `evolveResolved`'s exhaustive switch is what it decides through.
            const opening = awaitingReviewWithCandidate();
            const appended = await store.append('imp-1', 0, opening, META);
            expect(appended.isOk()).toBe(true);
            writeLegacyRow(database, 'imp-1', opening.length, 'ReviewResolved', {
              type: 'ReviewResolved',
              resolution: { kind: LEGACY_REJECT_VERB, reasons },
            });

            const read = await store.readStream('imp-1');
            const anImport = Import.fromHistory(read._unsafeUnwrap().map((row) => row.event));

            // The rejection was recorded in the importer's own vocabulary: the review is settled
            // (no open review left) but the phase holds, because the intake deletion is still
            // owed — and recording that deletion terminates the import with the reviewer's own
            // reasons. A verb the domain did not recognise could not have settled anything.
            expect(anImport.phase).toBe('awaiting-review');
            expect(anImport.snapshot.openReview).toBeUndefined();

            const deleted = anImport.execute({ type: 'RecordIntakeDeleted' })._unsafeUnwrap();
            expect(deleted).toEqual([
              {
                type: 'ImportRejected',
                reason: reasons.length > 0 ? reasons.join('; ') : 'rejected by review',
                filesDeleted: true,
              },
            ]);
          });
        },
      ),
    );
  });
});

describe('an event written today reads back as itself', () => {
  it('round-trips any current-version event through the store codec losslessly', async () => {
    await assertAsyncProperty(
      fc.asyncProperty(fc.array(arbEvent, { minLength: 1, maxLength: 5 }), async (events) => {
        await withStore(async (store) => {
          const appended = await store.append('imp-1', 0, events, META);
          // Asserted before the read is unwrapped: an append failure must report as itself, not as
          // a confusing empty-array mismatch further down.
          expect(appended.isOk()).toBe(true);

          const read = await store.readStream('imp-1');
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
