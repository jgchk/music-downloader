import { mkdtempSync, rmSync } from 'node:fs';
import { asCandidateIdentity } from '../../domain/shared/__fixtures__/candidate-identity.js';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { silentLogger } from '../../application/__fixtures__/fakes.js';
import type { AcquisitionEvent } from '../../domain/acquisition/events.js';
import type { EventMetadata, StoredEvent } from '../../application/ports/event-store-port.js';
import { InProcessEventBus } from './event-bus.js';
import { SqliteCheckpointStore, SqliteEventStore } from './event-store.js';
import { openEventDatabase, type EventDatabase } from './schema.js';
import { buildUpcasterRegistry, CURRENT_SCHEMA_VERSION, UpcasterRegistry } from './upcaster.js';

const META: EventMetadata = { acquisitionId: 'acq-1', occurredAt: '2026-07-03T12:00:00.000Z' };

const IMPORTED: AcquisitionEvent = {
  type: 'Imported',
  candidate: asCandidateIdentity({ username: 'peer', path: '/incoming/album', sizeBytes: 1024 }),
  location: '/library/album',
};
const FULFILLED: AcquisitionEvent = { type: 'AcquisitionFulfilled', location: '/library/album' };

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
    expect(appended.map((event) => event.type)).toEqual(['Imported', 'AcquisitionFulfilled']);
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

  it('upcasts stored events on read', async () => {
    const registry = new UpcasterRegistry().register(
      'AcquisitionFulfilled',
      CURRENT_SCHEMA_VERSION,
      (data) => ({ ...data, location: '/library/renamed' }),
    );
    const store = new SqliteEventStore(freshDatabase(), registry);
    await store.append('acq-1', 0, [FULFILLED], META);

    const readStreamResult2 = await store.readStream('acq-1');
    const read = readStreamResult2._unsafeUnwrap();

    expect(read[0]!.event).toEqual({ type: 'AcquisitionFulfilled', location: '/library/renamed' });
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
