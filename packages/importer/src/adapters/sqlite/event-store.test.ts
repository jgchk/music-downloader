import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { silentLogger } from '../../application/__fixtures__/fakes.js';
import type { ImportEvent } from '../../domain/import/events.js';
import type { AppendMetadata, StoredEvent } from '../../application/ports/event-store-port.js';
import { STORY, appendMetadata } from '../../application/__fixtures__/correlation.js';
import { toCorrelationId } from '../../application/correlation/correlation-id.js';
import {
  candidate,
  MATCH_REVIEW,
  proposed,
  requested,
  resolved,
  SOURCE,
} from '../../domain/import/__fixtures__/import-fixtures.js';
import { asDistance } from '../../domain/shared/__fixtures__/distance.js';
import { toImportId } from '../../domain/shared/import-id.js';
import { projectStatus } from '../../application/projections/read-models.js';
import { InProcessEventBus } from './event-bus.js';
import { SqliteCheckpointStore, SqliteEventStore } from './event-store.js';
import { legacyRejectResolvedData } from './__fixtures__/legacy-review-resolved.js';
import { openEventDatabase, type EventDatabase } from './schema.js';
import { toStoredToken } from './event-tokens.js';
import { buildUpcasterRegistry, CURRENT_SCHEMA_VERSION, UpcasterRegistry } from './upcaster.js';

const META: AppendMetadata = appendMetadata('imp-1', '2026-07-03T12:00:00.000Z');

const APPLIED: ImportEvent = { type: 'ImportApplied', location: '/library/album' };
const PROPOSED: ImportEvent = { type: 'MatchesProposed', candidates: [], duplicates: [] };
const REJECTED: ImportEvent = { type: 'ImportRejected', reason: 'done', filesDeleted: true };

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

    const appendResult = await store.append('imp-1', 0, [APPLIED, REJECTED], META);
    const appended = appendResult._unsafeUnwrap();
    expect(appended.map((event) => event.type)).toEqual(['ImportApplied', 'ImportRejected']);
    expect(appended.map((event) => event.version)).toEqual([0, 1]);
    expect(appended.map((event) => event.globalSeq)).toEqual([1, 2]);

    const readStreamResult = await store.readStream('imp-1');
    const read = readStreamResult._unsafeUnwrap();
    expect(read.map((event) => event.event)).toEqual([APPLIED, REJECTED]);
    expect(read[0]!.metadata).toEqual(META);
  });

  it('rejects an append whose expected version is stale (optimistic concurrency)', async () => {
    const store = new SqliteEventStore(freshDatabase());
    await store.append('imp-1', 0, [APPLIED], META);

    const conflict = await store.append('imp-1', 0, [REJECTED], META);

    expect(conflict._unsafeUnwrapErr()).toEqual({
      kind: 'ConcurrencyConflict',
      streamId: 'imp-1',
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
    raw.run(
      'imp-1',
      0,
      'ImportApplied',
      1,
      '{"type":"ImportApplied","location":"/library/album"}',
      '{}',
    );
    raw.run(
      'imp-1',
      2,
      'ImportApplied',
      1,
      '{"type":"ImportApplied","location":"/library/album"}',
      '{}',
    );

    const conflict = await store.append('imp-1', 2, [REJECTED], META);

    expect(conflict._unsafeUnwrapErr()).toMatchObject({ kind: 'ConcurrencyConflict' });
  });

  it('keeps streams independent and orders readAll by global sequence', async () => {
    const store = new SqliteEventStore(freshDatabase());
    await store.append('imp-1', 0, [APPLIED], META);
    await store.append('imp-2', 0, [REJECTED], { ...META, importId: 'imp-2' });

    const readAllResult = await store.readAll(0);
    const all = readAllResult._unsafeUnwrap();
    expect(all.map((event) => [event.streamId, event.globalSeq])).toEqual([
      ['imp-1', 1],
      ['imp-2', 2],
    ]);

    const readAllResult2 = await store.readAll(1);
    const tail = readAllResult2._unsafeUnwrap();
    expect(tail.map((event) => event.streamId)).toEqual(['imp-2']);
  });

  it('bounds a readAll batch by `limit`, windowing the global order for a checkpointed consumer', async () => {
    const store = new SqliteEventStore(freshDatabase());
    await store.append('imp-1', 0, [APPLIED, REJECTED], META);
    await store.append('imp-2', 0, [APPLIED], { ...META, importId: 'imp-2' });

    // A limited read returns only the first window after the cursor…
    const firstResult = await store.readAll(0, 2);
    const firstWindow = firstResult._unsafeUnwrap();
    expect(firstWindow.map((event) => event.globalSeq)).toEqual([1, 2]);

    // …and resuming from that window's end yields the next one, so a stepped drain covers all three.
    const nextResult = await store.readAll(2, 2);
    const nextWindow = nextResult._unsafeUnwrap();
    expect(nextWindow.map((event) => event.globalSeq)).toEqual([3]);
  });

  it('publishes committed events to the bus (publish-after-commit)', async () => {
    const bus = new InProcessEventBus(silentLogger());
    const store = new SqliteEventStore(freshDatabase(), new UpcasterRegistry(), bus);
    const seen: StoredEvent[] = [];
    bus.subscribe((event) => {
      seen.push(event);
    });

    await store.append('imp-1', 0, [APPLIED], META);

    expect(seen.map((event) => event.type)).toEqual(['ImportApplied']);
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

    const result = await store.append('imp-1', 0, [APPLIED], META);

    expect(result.isOk()).toBe(true);
    const readBack = await store.readStream('imp-1');
    expect(readBack._unsafeUnwrap()).toHaveLength(1);
  });

  it('stamps every appended event at the current schema version', async () => {
    const database = freshDatabase();
    const store = new SqliteEventStore(database);

    await store.append('imp-1', 0, [APPLIED], META);

    const row = database
      .prepare('SELECT schema_version AS schemaVersion FROM events WHERE stream_id = ?')
      .get('imp-1') as { schemaVersion: number };
    expect(row.schemaVersion).toBe(CURRENT_SCHEMA_VERSION);
  });

  it('writes the frozen storage token to both the type column and the data blob', async () => {
    const database = freshDatabase();
    const store = new SqliteEventStore(database);

    await store.append('imp-1', 0, [PROPOSED], META);

    // PROPOSED is the model's `MatchesProposed`; disk has always called it `CandidatesProposed`,
    // and the blob must agree with the column it is indexed by.
    const row = database
      .prepare('SELECT type, data FROM events WHERE stream_id = ?')
      .get('imp-1') as { type: string; data: string };
    expect(row.type).toBe('CandidatesProposed');
    expect((JSON.parse(row.data) as { type: string }).type).toBe('CandidatesProposed');
  });

  it('reads a row written before the rename as the current model type, upcasting by its token', async () => {
    const database = freshDatabase();
    // The upcaster is keyed by the STORED token — a renamed event proves the ordering matters.
    const registry = new UpcasterRegistry().register(
      'CandidatesProposed',
      CURRENT_SCHEMA_VERSION,
      (data) => ({ ...data, upcasted: true }),
    );
    const store = new SqliteEventStore(database, registry);
    database
      .prepare(
        `INSERT INTO events (stream_id, version, type, schema_version, data, metadata)
         VALUES (?, ?, ?, ?, ?, ?)`,
      )
      .run(
        'imp-1',
        0,
        'CandidatesProposed',
        CURRENT_SCHEMA_VERSION,
        '{"type":"CandidatesProposed","candidates":[]}',
        '{}',
      );

    const readResult = await store.readStream('imp-1');
    const read = readResult._unsafeUnwrap();

    expect(read[0]!.type).toBe('MatchesProposed');
    expect(read[0]!.event).toMatchObject({ type: 'MatchesProposed', upcasted: true });
  });

  it('upcasts stored events on read', async () => {
    // Registered at the version `append` stamps, so a freshly-stored row is lifted on read-back.
    const registry = new UpcasterRegistry().register(
      'ImportApplied',
      CURRENT_SCHEMA_VERSION,
      (data) => ({
        ...data,
        location: '/library/renamed',
      }),
    );
    const store = new SqliteEventStore(freshDatabase(), registry);
    await store.append('imp-1', 0, [APPLIED], META);

    const readStreamResult2 = await store.readStream('imp-1');
    const read = readStreamResult2._unsafeUnwrap();

    expect(read[0]!.event).toEqual({ type: 'ImportApplied', location: '/library/renamed' });
  });

  it('reads a legacy v1 rejection stream identically to a natively-written v2 one', async () => {
    // The legacy-tolerance guarantee: a downloader-delivered import rejected as unusable, whose
    // `ReviewResolved` was persisted under the pre-rename verb at schema v1, must fold and project
    // exactly as a stream written natively today (the verb upcast on read, its store carrying it).
    const reasons = ['corrupt rip'];
    const nativeEvents: ImportEvent[] = [
      requested({ source: SOURCE }),
      proposed([candidate({ distance: asDistance(0.5) })]),
      MATCH_REVIEW,
      resolved({ kind: 'reject-unusable-delivery', reasons }),
      { type: 'ImportRejected', reason: 'corrupt rip', filesDeleted: true },
    ];

    const nativeStore = new SqliteEventStore(freshDatabase(), buildUpcasterRegistry());
    const nativeAppend = await nativeStore.append('imp-native', 0, nativeEvents, META);
    nativeAppend._unsafeUnwrap();
    const nativeReadResult = await nativeStore.readStream('imp-native');
    const nativeRead = nativeReadResult._unsafeUnwrap();

    // The same stream raw-inserted at schema v1, its `ReviewResolved` carrying the old verb.
    const legacyDatabase = freshDatabase();
    const insert = legacyDatabase.prepare(
      `INSERT INTO events (stream_id, version, type, schema_version, data, metadata)
       VALUES (?, ?, ?, 1, ?, ?)`,
    );
    for (const [version, event] of nativeEvents.entries()) {
      const data = event.type === 'ReviewResolved' ? legacyRejectResolvedData(reasons) : event;
      // The column holds STORED tokens — writing the model name here would build a stream that
      // could never exist on disk, and the legacy-fidelity claim would be vacuous.
      insert.run(
        'imp-legacy',
        version,
        toStoredToken(event.type),
        JSON.stringify(data),
        JSON.stringify(META),
      );
    }
    const legacyStore = new SqliteEventStore(legacyDatabase, buildUpcasterRegistry());
    const legacyReadResult = await legacyStore.readStream('imp-legacy');
    const legacyRead = legacyReadResult._unsafeUnwrap();

    const nativeView = projectStatus(toImportId('imp-native'), nativeRead);
    const legacyView = projectStatus(toImportId('imp-legacy'), legacyRead);

    // The folded state settles terminal and the history projects the importer's own verb…
    expect(legacyView.phase).toBe('rejected');
    expect(legacyView.history.find((entry) => entry.kind === 'review-resolved')).toMatchObject({
      resolution: 'reject-unusable-delivery',
    });
    // …identically to the natively-written stream (only the stream's own id differs).
    expect({ ...legacyView, importId: nativeView.importId }).toEqual(nativeView);
  });

  it('surfaces an infrastructure fault from append', async () => {
    const database = freshDatabase();
    const store = new SqliteEventStore(database);
    database.close();

    const result = await store.append('imp-1', 0, [APPLIED], META);

    expect(result._unsafeUnwrapErr()).toMatchObject({
      kind: 'InfraError',
      operation: 'event-store.append',
    });
  });

  it('surfaces an infrastructure fault from readStream', async () => {
    const database = freshDatabase();
    const store = new SqliteEventStore(database);
    database.close();

    const result = await store.readStream('imp-1');

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
    const directory = mkdtempSync(path.join(tmpdir(), 'mi-events-'));
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
    const seeded = await store.append('imp-1', 0, [APPLIED], META);
    seeded._unsafeUnwrap();
    database.prepare('UPDATE events SET metadata = ?').run('null');

    const read = await store.readStream('imp-1');

    expect(read.isOk()).toBe(true);
  });

  it('hands a metadata column holding a JSON scalar back untouched, fabricating nothing', async () => {
    // `null` is not the only thing hand-editing leaves in the column. Reshaping a scalar into the
    // metadata object it is declared to be would BUILD provenance out of nothing — `{...'gone'}`
    // is `{0:'g',1:'o',…}`, indistinguishable to a reader from a row that really was written that
    // way. An unreadable row stays exactly as unreadable as it was found.
    const database = freshDatabase();
    const store = new SqliteEventStore(database);
    const seeded = await store.append('imp-1', 0, [APPLIED], META);
    seeded._unsafeUnwrap();
    database.prepare('UPDATE events SET metadata = ?').run('"gone"');

    const read = await store.readStream('imp-1');

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
    const seeded = await store.append('imp-1', 0, [APPLIED], META);
    seeded._unsafeUnwrap();
    database.prepare('UPDATE events SET metadata = ?').run(
      JSON.stringify({
        importId: 'imp-1',
        occurredAt: '2026-07-03T12:00:00.000Z',
        correlationId: STORY,
        causation: { kind: 'event', context: 'elsewhere', streamId: 'other-1' }, // no version
      }),
    );

    const stream = await store.readStream('imp-1');

    const read = stream._unsafeUnwrap();
    expect(read[0]!.metadata.causation).toBeUndefined();
    expect(read[0]!.metadata.correlationId).toBe(STORY);
  });

  it('reads a stored causation reference back as the union it was written as', async () => {
    // The column is JSON and metadata has no upcaster, so the read-edge parse is the only thing
    // standing between a persisted union and a reader narrowing on a tag nothing ever checked.
    const store = new SqliteEventStore(freshDatabase());
    const written = appendMetadata('imp-1', 't', {
      correlationId: toCorrelationId(STORY),
      causation: { kind: 'event', context: 'elsewhere', streamId: 'other-1', version: 4 },
    });

    const appended = await store.append('imp-1', 0, [APPLIED], written);
    appended._unsafeUnwrap();

    const stream = await store.readStream('imp-1');
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
