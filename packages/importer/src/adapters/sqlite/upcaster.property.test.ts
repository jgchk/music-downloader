import fc from 'fast-check';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { assertAsyncProperty } from '../../__fixtures__/property.js';
import type { EventMetadata } from '../../application/ports/event-store-port.js';
import { Import } from '../../domain/import/import.js';
import { arbEvent } from '../../domain/import/__fixtures__/arbitraries.js';
import { LEGACY_REJECT_VERB } from './__fixtures__/legacy-review-resolved.js';
import { SqliteEventStore } from './event-store.js';
import { openEventDatabase } from './schema.js';
import type { EventDatabase } from './schema.js';
import { buildUpcasterRegistry } from './upcaster.js';

/**
 * Upcaster round-trips as a codec property (decider-properties D2, task 3.1). The example tests
 * next door pin the payloads someone thought to write down; this pins the *contract* against
 * generated v1 shapes, through the production path — the real `SqliteEventStore`, its JSON
 * encode/decode, and the real `buildUpcasterRegistry()` — because the seam that rots is the wiring
 * between them, not the transform in isolation.
 */

const META: EventMetadata = { importId: 'imp', occurredAt: '2026-08-06T00:00:00.000Z' };

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

  /** Write a payload straight to the events table at schema version 1, as a legacy writer did. */
  function writeLegacyRow(streamId: string, type: string, data: Record<string, unknown>): void {
    database
      .prepare(
        `INSERT INTO events (stream_id, version, type, schema_version, data, metadata)
         VALUES (?, ?, ?, ?, ?, ?)`,
      )
      .run(streamId, 0, type, 1, JSON.stringify(data), JSON.stringify(META));
  }

  it('renames the legacy rejection verb forward and leaves every other verb alone', async () => {
    await assertAsyncProperty(
      fc.asyncProperty(arbLegacyResolved, async (legacyResolution) => {
        const streamId = `imp-${String((streams += 1))}`;
        writeLegacyRow(streamId, 'ReviewResolved', {
          type: 'ReviewResolved',
          resolution: legacyResolution,
        });

        const read = await store.readStream(streamId);
        const stored = read._unsafeUnwrap();

        const event = stored[0]?.event;
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
      }),
    );
  });

  it('passes a legacy row of any unregistered type through untouched', async () => {
    await assertAsyncProperty(
      fc.asyncProperty(arbEvent, async (event) => {
        fc.pre(event.type !== 'ReviewResolved'); // the one type with a step registered
        const streamId = `imp-${String((streams += 1))}`;
        writeLegacyRow(streamId, event.type, structuredClone(event));

        const read = await store.readStream(streamId);
        const stored = read._unsafeUnwrap();

        expect(stored[0]?.event).toEqual(event);
      }),
    );
  });

  it('leaves the upcasted resolution foldable — the aggregate never sees a v1 verb', async () => {
    await assertAsyncProperty(
      fc.asyncProperty(arbLegacyResolved, async (legacyResolution) => {
        const streamId = `imp-${String((streams += 1))}`;
        writeLegacyRow(streamId, 'ReviewResolved', {
          type: 'ReviewResolved',
          resolution: legacyResolution,
        });

        const read = await store.readStream(streamId);
        const anImport = Import.fromHistory(read._unsafeUnwrap().map((row) => row.event));

        // Folded onto an empty stream the resolution is ignored, but it must fold at all — an
        // unrecognized verb would strand `evolveResolved`'s exhaustive switch.
        expect(anImport.phase).toBe('empty');
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
        const streamId = `imp-${String((streams += 1))}`;

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
