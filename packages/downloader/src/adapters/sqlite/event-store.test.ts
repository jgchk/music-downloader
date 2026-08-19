import { mkdtempSync, rmSync } from 'node:fs';
import { asCandidateIdentity } from '../../domain/shared/__fixtures__/candidate-identity.js';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { silentLogger } from '../../application/__fixtures__/fakes.js';
import type { DownloadEvent } from '../../domain/download/events.js';
import type { AppendMetadata, StoredEvent } from '../../application/ports/event-store-port.js';
import { STORY, appendMetadata } from '../../application/__fixtures__/correlation.js';
import { toCorrelationId } from '../../application/correlation/correlation-id.js';
import { InProcessEventBus } from './event-bus.js';
import { SqliteCheckpointStore, SqliteEventStore } from './event-store.js';
import { openEventDatabase, type EventDatabase } from './schema.js';
import { buildUpcasterRegistry, CURRENT_SCHEMA_VERSION, UpcasterRegistry } from './upcaster.js';

const META: AppendMetadata = appendMetadata('acq-1', '2026-07-03T12:00:00.000Z');

const IMPORTED: DownloadEvent = {
  type: 'Imported',
  candidate: asCandidateIdentity({ username: 'peer', path: '/incoming/album', sizeBytes: 1024 }),
  location: '/library/album',
};
const FULFILLED: DownloadEvent = { type: 'DownloadFulfilled', location: '/library/album' };

const openDbs: EventDatabase[] = [];
const temporaryDirectories: string[] = [];

function freshDatabase(): EventDatabase {
  const database = openEventDatabase(':memory:');
  openDbs.push(database);
  return database;
}

afterEach(() => {
  for (const database of openDbs) {
    if (database.open) database.close();
  }
  openDbs.length = 0;
  for (const directory of temporaryDirectories) rmSync(directory, { recursive: true, force: true });
  temporaryDirectories.length = 0;
});

describe('SqliteEventStore', () => {
  it('round-trips events and metadata through a stream', async () => {
    const store = new SqliteEventStore(freshDatabase());

    const appendResult = await store.append('acq-1', 0, [IMPORTED, FULFILLED], META);
    const appended = appendResult._unsafeUnwrap();
    expect(appended.map((event) => event.type)).toEqual(['Imported', 'DownloadFulfilled']);
    expect(appended.map((event) => event.version)).toEqual([0, 1]);
    expect(appended.map((event) => event.globalSeq)).toEqual([1, 2]);

    const readStreamResult = await store.readStream('acq-1');
    const read = readStreamResult._unsafeUnwrap();
    expect(read.map((event) => event.event)).toEqual([IMPORTED, FULFILLED]);
    expect(read[0]!.metadata).toEqual(META);
  });

  it('rejects an append whose expected version is stale (optimistic concurrency)', async () => {
    const store = new SqliteEventStore(freshDatabase());
    await store.append('acq-1', 0, [IMPORTED], META);

    const conflict = await store.append('acq-1', 0, [FULFILLED], META);

    expect(conflict._unsafeUnwrapErr()).toEqual({
      kind: 'ConcurrencyConflict',
      streamId: 'acq-1',
      expectedVersion: 0,
    });
  });

  it('maps a UNIQUE(stream_id, version) collision to a ConcurrencyConflict', async () => {
    const database = freshDatabase();
    const store = new SqliteEventStore(database);
    // Seed a non-contiguous stream directly: versions 0 and 2 exist, so count() == 2 but
    // appending at expectedVersion 2 collides with the pre-existing version-2 row.
    const raw = database.prepare(
      `INSERT INTO events (stream_id, version, type, schema_version, data, metadata)
       VALUES (?, ?, ?, ?, ?, ?)`,
    );
    // Raw seeding bypasses the token seam, so these must be the STORED token for the model's
    // `DownloadExhausted` — writing the model name here would describe a row that cannot exist.
    raw.run('acq-1', 0, 'AcquisitionExhausted', 1, '{"type":"AcquisitionExhausted"}', '{}');
    raw.run('acq-1', 2, 'AcquisitionExhausted', 1, '{"type":"AcquisitionExhausted"}', '{}');

    const conflict = await store.append('acq-1', 2, [FULFILLED], META);

    expect(conflict._unsafeUnwrapErr()).toMatchObject({ kind: 'ConcurrencyConflict' });
  });

  it('keeps streams independent and orders readAll by global sequence', async () => {
    const store = new SqliteEventStore(freshDatabase());
    await store.append('acq-1', 0, [IMPORTED], META);
    await store.append('acq-2', 0, [FULFILLED], { ...META, acquisitionId: 'acq-2' });

    const readAllResult = await store.readAll(0);
    const all = readAllResult._unsafeUnwrap();
    expect(all.map((event) => [event.streamId, event.globalSeq])).toEqual([
      ['acq-1', 1],
      ['acq-2', 2],
    ]);

    const readAllResult2 = await store.readAll(1);
    const tail = readAllResult2._unsafeUnwrap();
    expect(tail.map((event) => event.streamId)).toEqual(['acq-2']);
  });

  it('publishes committed events to the bus (publish-after-commit)', async () => {
    const bus = new InProcessEventBus(silentLogger());
    const store = new SqliteEventStore(freshDatabase(), new UpcasterRegistry(), bus);
    const seen: StoredEvent[] = [];
    bus.subscribe((event) => {
      seen.push(event);
    });

    await store.append('acq-1', 0, [IMPORTED], META);

    expect(seen.map((event) => event.type)).toEqual(['Imported']);
    expect(seen[0]!.globalSeq).toBe(1);
  });

  it('still commits (returns ok) when a publish-after-commit subscriber throws', async () => {
    // publish() runs AFTER the append transaction commits: a subscriber that throws must never
    // turn an already-durable append into a failure. The bus isolates the throw; append stays ok.
    const bus = new InProcessEventBus(silentLogger());
    const store = new SqliteEventStore(freshDatabase(), new UpcasterRegistry(), bus);
    bus.subscribe(() => {
      throw new Error('projection boom');
    });

    const result = await store.append('acq-1', 0, [IMPORTED], META);

    expect(result.isOk()).toBe(true);
    const readBack = await store.readStream('acq-1');
    expect(readBack._unsafeUnwrap()).toHaveLength(1);
  });

  it('stamps every appended event at the current schema version', async () => {
    const database = freshDatabase();
    const store = new SqliteEventStore(database);

    await store.append('acq-1', 0, [IMPORTED], META);

    const row = database
      .prepare('SELECT schema_version AS schemaVersion FROM events WHERE stream_id = ?')
      .get('acq-1') as { schemaVersion: number };
    expect(row.schemaVersion).toBe(CURRENT_SCHEMA_VERSION);
  });

  it('upcasts a legacy row forward through the real registry on read', async () => {
    const database = freshDatabase();
    const store = new SqliteEventStore(database, buildUpcasterRegistry());
    // A v1 ManualSelectionRequested row written before EditionCandidate.trackCount became optional:
    // an unknown count was stored as the sentinel 0. The real registry must fold it to absent.
    database
      .prepare(
        `INSERT INTO events (stream_id, version, type, schema_version, data, metadata)
         VALUES (?, ?, ?, ?, ?, ?)`,
      )
      .run(
        'acq-1',
        0,
        'ManualSelectionRequested',
        1,
        JSON.stringify({
          type: 'ManualSelectionRequested',
          candidates: [{ releaseMbid: 'b', title: 'Unknown', trackCount: 0 }],
        }),
        '{}',
      );

    const readResult = await store.readStream('acq-1');
    const read = readResult._unsafeUnwrap();

    expect(read[0]!.event).toEqual({
      type: 'ManualSelectionRequested',
      candidates: [{ releaseMbid: 'b', title: 'Unknown' }],
    });
  });

  it('upcasts by default: a store built without a registry still lifts legacy rows', async () => {
    // The default registry is the populated one, so a wiring omission cannot silently serve
    // un-upcast events; an empty `new UpcasterRegistry()` is an explicit, deliberate opt-out.
    const database = freshDatabase();
    const store = new SqliteEventStore(database);
    database
      .prepare(
        `INSERT INTO events (stream_id, version, type, schema_version, data, metadata)
         VALUES (?, ?, ?, ?, ?, ?)`,
      )
      .run(
        'acq-1',
        0,
        'ManualSelectionRequested',
        1,
        JSON.stringify({
          type: 'ManualSelectionRequested',
          candidates: [{ releaseMbid: 'b', title: 'Unknown', trackCount: 0 }],
        }),
        '{}',
      );

    const readResult = await store.readStream('acq-1');
    const read = readResult._unsafeUnwrap();
    expect(read[0]!.event).toEqual({
      type: 'ManualSelectionRequested',
      candidates: [{ releaseMbid: 'b', title: 'Unknown' }],
    });
  });

  it('writes the frozen storage token to both the type column and the data blob', async () => {
    const database = freshDatabase();
    const store = new SqliteEventStore(database);

    await store.append('acq-1', 0, [FULFILLED], META);

    // FULFILLED is the model's `DownloadFulfilled`; disk has always called it
    // `AcquisitionFulfilled`, and the blob must agree with the column it is indexed by — an
    // out-of-band reader (DB surgery, a migration, analytics) sees only these two.
    const row = database
      .prepare('SELECT type, data FROM events WHERE stream_id = ?')
      .get('acq-1') as { type: string; data: string };
    expect(row.type).toBe('AcquisitionFulfilled');
    expect((JSON.parse(row.data) as { type: string }).type).toBe('AcquisitionFulfilled');
  });

  it('hands back an event type it does not know rather than dropping the row', async () => {
    const database = freshDatabase();
    const store = new SqliteEventStore(database, buildUpcasterRegistry());
    // What a newer build would have written. The row must survive the read intact — the deciders
    // are total over an unknown tag, so tolerating it here loses nothing.
    database
      .prepare(
        `INSERT INTO events (stream_id, version, type, schema_version, data, metadata)
         VALUES (?, ?, ?, ?, ?, ?)`,
      )
      .run(
        'acq-1',
        0,
        'SomethingNobodyKnows',
        CURRENT_SCHEMA_VERSION,
        '{"type":"SomethingNobodyKnows"}',
        '{}',
      );

    const readResult = await store.readStream('acq-1');
    const read = readResult._unsafeUnwrap();

    expect(read).toHaveLength(1);
    expect(read[0]!.type).toBe('SomethingNobodyKnows');
  });

  it('reads a row written before the rename as the current model type', async () => {
    const database = freshDatabase();
    const store = new SqliteEventStore(database);
    // Exactly the bytes a pre-rename release wrote.
    database
      .prepare(
        `INSERT INTO events (stream_id, version, type, schema_version, data, metadata)
         VALUES (?, ?, ?, ?, ?, ?)`,
      )
      .run(
        'acq-1',
        0,
        'AcquisitionFulfilled',
        CURRENT_SCHEMA_VERSION,
        '{"type":"AcquisitionFulfilled","location":"/library/album"}',
        '{}',
      );

    const readResult = await store.readStream('acq-1');
    const read = readResult._unsafeUnwrap();

    expect(read[0]!.type).toBe('DownloadFulfilled');
    expect(read[0]!.event).toEqual({ type: 'DownloadFulfilled', location: '/library/album' });
  });

  it('upcasts stored events on read', async () => {
    // Registered under the STORED token, not the model's name for this event: upcasters run
    // against the raw on-disk shape, before the token is translated into model vocabulary.
    const registry = new UpcasterRegistry().register(
      'AcquisitionFulfilled',
      CURRENT_SCHEMA_VERSION,
      (data) => ({ ...data, location: '/library/renamed' }),
    );
    const store = new SqliteEventStore(freshDatabase(), registry);
    await store.append('acq-1', 0, [FULFILLED], META);

    const readStreamResult2 = await store.readStream('acq-1');
    const read = readStreamResult2._unsafeUnwrap();

    expect(read[0]!.event).toEqual({ type: 'DownloadFulfilled', location: '/library/renamed' });
  });

  it('surfaces an infrastructure fault from append', async () => {
    const database = freshDatabase();
    const store = new SqliteEventStore(database);
    database.close();

    const result = await store.append('acq-1', 0, [IMPORTED], META);

    expect(result._unsafeUnwrapErr()).toMatchObject({
      kind: 'InfraError',
      operation: 'event-store.append',
    });
  });

  it('surfaces an infrastructure fault from readStream', async () => {
    const database = freshDatabase();
    const store = new SqliteEventStore(database);
    database.close();

    const result = await store.readStream('acq-1');

    expect(result._unsafeUnwrapErr()).toMatchObject({ operation: 'event-store.readStream' });
  });

  it('surfaces an infrastructure fault from readAll', async () => {
    const database = freshDatabase();
    const store = new SqliteEventStore(database);
    database.close();

    const result = await store.readAll(0);

    expect(result._unsafeUnwrapErr()).toMatchObject({ operation: 'event-store.readAll' });
  });

  it('enables WAL journaling on a file-backed database', () => {
    const directory = mkdtempSync(path.join(tmpdir(), 'md-events-'));
    temporaryDirectories.push(directory);
    const database = openEventDatabase(path.join(directory, 'events.db'));
    openDbs.push(database);

    expect(database.pragma('journal_mode', { simple: true })).toBe('wal');
  });
});

describe('SqliteCheckpointStore', () => {
  it('returns 0 for a consumer that has never checkpointed', async () => {
    const checkpoints = new SqliteCheckpointStore(freshDatabase());

    const loadResult = await checkpoints.load('reactor');
    expect(loadResult._unsafeUnwrap()).toBe(0);
  });

  it('persists and upserts the last processed sequence', async () => {
    const checkpoints = new SqliteCheckpointStore(freshDatabase());

    await checkpoints.save('reactor', 5);
    const loadResult2 = await checkpoints.load('reactor');
    expect(loadResult2._unsafeUnwrap()).toBe(5);

    await checkpoints.save('reactor', 9);
    const loadResult3 = await checkpoints.load('reactor');
    expect(loadResult3._unsafeUnwrap()).toBe(9);
  });

  it('surfaces an infrastructure fault from load', async () => {
    const database = freshDatabase();
    const checkpoints = new SqliteCheckpointStore(database);
    database.close();

    const result = await checkpoints.load('reactor');

    expect(result._unsafeUnwrapErr()).toMatchObject({ operation: 'checkpoint.load' });
  });

  it('surfaces an infrastructure fault from save', async () => {
    const database = freshDatabase();
    const checkpoints = new SqliteCheckpointStore(database);
    database.close();

    const result = await checkpoints.save('reactor', 1);

    expect(result._unsafeUnwrapErr()).toMatchObject({ operation: 'checkpoint.save' });
  });
});

describe('SqliteEventStore — correlation metadata round trip', () => {
  it('degrades a row whose metadata is not an object at all, rather than wedging the stream', async () => {
    // DB surgery on the event store is a documented ops procedure here. A throw would become an
    // InfraError for the WHOLE read, so one hand-edited row would hold the reactor's checkpoint
    // forever — the opposite of how every other unreadable-provenance path behaves.
    const database = freshDatabase();
    const store = new SqliteEventStore(database);
    const seeded = await store.append('acq-1', 0, [IMPORTED], META);
    seeded._unsafeUnwrap();
    database.prepare('UPDATE events SET metadata = ?').run('null');

    const read = await store.readStream('acq-1');

    expect(read.isOk()).toBe(true);
  });

  it('hands a metadata column holding a JSON scalar back untouched, fabricating nothing', async () => {
    // `null` is not the only thing hand-editing leaves in the column. Reshaping a scalar into the
    // metadata object it is declared to be would BUILD provenance out of nothing — `{...'gone'}`
    // is `{0:'g',1:'o',…}`, indistinguishable to a reader from a row that really was written that
    // way. An unreadable row stays exactly as unreadable as it was found.
    const database = freshDatabase();
    const store = new SqliteEventStore(database);
    const seeded = await store.append('acq-1', 0, [IMPORTED], META);
    seeded._unsafeUnwrap();
    database.prepare('UPDATE events SET metadata = ?').run('"gone"');

    const read = await store.readStream('acq-1');

    expect(read._unsafeUnwrap()[0]!.metadata as unknown).toBe('gone');
  });

  it('drops a stored causation reference it cannot parse, leaving the rest of the row readable', async () => {
    // The write path types `causation` as the union, but the column is JSON with no upcaster and
    // no schema behind it, so a row hand-edited (or written by some past version) can hold any
    // shape at all. A reference this reader cannot read is NO reference — it must come back
    // `undefined` rather than as a half-built object whose tag a reader would narrow on. The story
    // beside it is independently readable and must survive.
    const database = freshDatabase();
    const store = new SqliteEventStore(database);
    const seeded = await store.append('acq-1', 0, [IMPORTED], META);
    seeded._unsafeUnwrap();
    database.prepare('UPDATE events SET metadata = ?').run(
      JSON.stringify({
        acquisitionId: 'acq-1',
        occurredAt: '2026-07-03T12:00:00.000Z',
        correlationId: STORY,
        causation: { kind: 'event', context: 'elsewhere', streamId: 'other-1' }, // no version
      }),
    );

    const stream = await store.readStream('acq-1');

    const read = stream._unsafeUnwrap();
    expect(read[0]!.metadata.causation).toBeUndefined();
    expect(read[0]!.metadata.correlationId).toBe(STORY);
  });

  it('reads a stored causation reference back as the union it was written as', async () => {
    // The column is JSON and metadata has no upcaster, so the read-edge parse is the only thing
    // standing between a persisted union and a reader narrowing on a tag nothing ever checked.
    const store = new SqliteEventStore(freshDatabase());
    const written = appendMetadata('acq-1', 't', {
      correlationId: toCorrelationId(STORY),
      causation: { kind: 'event', context: 'elsewhere', streamId: 'other-1', version: 4 },
    });

    const appended = await store.append('acq-1', 0, [IMPORTED], written);
    appended._unsafeUnwrap();

    const stream = await store.readStream('acq-1');
    const read = stream._unsafeUnwrap();
    expect(read[0]!.metadata.causation).toEqual({
      kind: 'event',
      context: 'elsewhere',
      streamId: 'other-1',
      version: 4,
    });
    expect(read[0]!.metadata.correlationId).toBe(STORY);
  });
});
