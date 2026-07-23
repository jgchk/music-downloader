import { mkdtempSync, rmSync } from 'node:fs';
import { asCandidateIdentity } from '../../domain/shared/__fixtures__/candidate-identity.js';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import type { AcquisitionEvent } from '../../domain/acquisition/events.js';
import type { EventMetadata, StoredEvent } from '../../application/ports/event-store-port.js';
import { InProcessEventBus } from './event-bus.js';
import { SqliteCheckpointStore, SqliteEventStore } from './event-store.js';
import { openEventDatabase, type EventDatabase } from './schema.js';
import { UpcasterRegistry } from './upcaster.js';

const META: EventMetadata = { acquisitionId: 'acq-1', occurredAt: '2026-07-03T12:00:00.000Z' };

const IMPORTED: AcquisitionEvent = {
  type: 'Imported',
  candidate: asCandidateIdentity({ username: 'peer', path: '/incoming/album', sizeBytes: 1024 }),
  location: '/library/album',
};
const FULFILLED: AcquisitionEvent = { type: 'AcquisitionFulfilled', location: '/library/album' };

const openDbs: EventDatabase[] = [];
const tmpDirs: string[] = [];

function freshDb(): EventDatabase {
  const db = openEventDatabase(':memory:');
  openDbs.push(db);
  return db;
}

afterEach(() => {
  for (const db of openDbs.splice(0)) {
    if (db.open) db.close();
  }
  for (const dir of tmpDirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

describe('SqliteEventStore', () => {
  it('round-trips events and metadata through a stream', async () => {
    const store = new SqliteEventStore(freshDb());

    const appended = (await store.append('acq-1', 0, [IMPORTED, FULFILLED], META))._unsafeUnwrap();
    expect(appended.map((e) => e.type)).toEqual(['Imported', 'AcquisitionFulfilled']);
    expect(appended.map((e) => e.version)).toEqual([0, 1]);
    expect(appended.map((e) => e.globalSeq)).toEqual([1, 2]);

    const read = (await store.readStream('acq-1'))._unsafeUnwrap();
    expect(read.map((e) => e.event)).toEqual([IMPORTED, FULFILLED]);
    expect(read[0]!.metadata).toEqual(META);
  });

  it('rejects an append whose expected version is stale (optimistic concurrency)', async () => {
    const store = new SqliteEventStore(freshDb());
    await store.append('acq-1', 0, [IMPORTED], META);

    const conflict = await store.append('acq-1', 0, [FULFILLED], META);

    expect(conflict._unsafeUnwrapErr()).toEqual({
      kind: 'ConcurrencyConflict',
      streamId: 'acq-1',
      expectedVersion: 0,
    });
  });

  it('maps a UNIQUE(stream_id, version) collision to a ConcurrencyConflict', async () => {
    const db = freshDb();
    const store = new SqliteEventStore(db);
    // Seed a non-contiguous stream directly: versions 0 and 2 exist, so count() == 2 but
    // appending at expectedVersion 2 collides with the pre-existing version-2 row.
    const raw = db.prepare(
      `INSERT INTO events (stream_id, version, type, schema_version, data, metadata)
       VALUES (?, ?, ?, ?, ?, ?)`,
    );
    raw.run('acq-1', 0, 'AcquisitionExhausted', 1, '{"type":"AcquisitionExhausted"}', '{}');
    raw.run('acq-1', 2, 'AcquisitionExhausted', 1, '{"type":"AcquisitionExhausted"}', '{}');

    const conflict = await store.append('acq-1', 2, [FULFILLED], META);

    expect(conflict._unsafeUnwrapErr()).toMatchObject({ kind: 'ConcurrencyConflict' });
  });

  it('keeps streams independent and orders readAll by global sequence', async () => {
    const store = new SqliteEventStore(freshDb());
    await store.append('acq-1', 0, [IMPORTED], META);
    await store.append('acq-2', 0, [FULFILLED], { ...META, acquisitionId: 'acq-2' });

    const all = (await store.readAll(0))._unsafeUnwrap();
    expect(all.map((e) => [e.streamId, e.globalSeq])).toEqual([
      ['acq-1', 1],
      ['acq-2', 2],
    ]);

    const tail = (await store.readAll(1))._unsafeUnwrap();
    expect(tail.map((e) => e.streamId)).toEqual(['acq-2']);
  });

  it('publishes committed events to the bus (publish-after-commit)', async () => {
    const bus = new InProcessEventBus();
    const store = new SqliteEventStore(freshDb(), new UpcasterRegistry(), bus);
    const seen: StoredEvent[] = [];
    bus.subscribe((event) => seen.push(event));

    await store.append('acq-1', 0, [IMPORTED], META);

    expect(seen.map((e) => e.type)).toEqual(['Imported']);
    expect(seen[0]!.globalSeq).toBe(1);
  });

  it('upcasts stored events on read', async () => {
    const registry = new UpcasterRegistry().register('AcquisitionFulfilled', 1, (data) => ({
      ...data,
      location: '/library/renamed',
    }));
    const store = new SqliteEventStore(freshDb(), registry);
    await store.append('acq-1', 0, [FULFILLED], META);

    const read = (await store.readStream('acq-1'))._unsafeUnwrap();

    expect(read[0]!.event).toEqual({ type: 'AcquisitionFulfilled', location: '/library/renamed' });
  });

  it('surfaces an infrastructure fault from append', async () => {
    const db = freshDb();
    const store = new SqliteEventStore(db);
    db.close();

    const result = await store.append('acq-1', 0, [IMPORTED], META);

    expect(result._unsafeUnwrapErr()).toMatchObject({
      kind: 'InfraError',
      operation: 'event-store.append',
    });
  });

  it('surfaces an infrastructure fault from readStream', async () => {
    const db = freshDb();
    const store = new SqliteEventStore(db);
    db.close();

    const result = await store.readStream('acq-1');

    expect(result._unsafeUnwrapErr()).toMatchObject({ operation: 'event-store.readStream' });
  });

  it('surfaces an infrastructure fault from readAll', async () => {
    const db = freshDb();
    const store = new SqliteEventStore(db);
    db.close();

    const result = await store.readAll(0);

    expect(result._unsafeUnwrapErr()).toMatchObject({ operation: 'event-store.readAll' });
  });

  it('enables WAL journaling on a file-backed database', () => {
    const dir = mkdtempSync(join(tmpdir(), 'md-events-'));
    tmpDirs.push(dir);
    const db = openEventDatabase(join(dir, 'events.db'));
    openDbs.push(db);

    expect(db.pragma('journal_mode', { simple: true })).toBe('wal');
  });
});

describe('SqliteCheckpointStore', () => {
  it('returns 0 for a consumer that has never checkpointed', async () => {
    const checkpoints = new SqliteCheckpointStore(freshDb());

    expect((await checkpoints.load('reactor'))._unsafeUnwrap()).toBe(0);
  });

  it('persists and upserts the last processed sequence', async () => {
    const checkpoints = new SqliteCheckpointStore(freshDb());

    await checkpoints.save('reactor', 5);
    expect((await checkpoints.load('reactor'))._unsafeUnwrap()).toBe(5);

    await checkpoints.save('reactor', 9);
    expect((await checkpoints.load('reactor'))._unsafeUnwrap()).toBe(9);
  });

  it('surfaces an infrastructure fault from load', async () => {
    const db = freshDb();
    const checkpoints = new SqliteCheckpointStore(db);
    db.close();

    const result = await checkpoints.load('reactor');

    expect(result._unsafeUnwrapErr()).toMatchObject({ operation: 'checkpoint.load' });
  });

  it('surfaces an infrastructure fault from save', async () => {
    const db = freshDb();
    const checkpoints = new SqliteCheckpointStore(db);
    db.close();

    const result = await checkpoints.save('reactor', 1);

    expect(result._unsafeUnwrapErr()).toMatchObject({ operation: 'checkpoint.save' });
  });
});
