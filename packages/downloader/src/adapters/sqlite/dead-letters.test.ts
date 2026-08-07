import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import Database from 'better-sqlite3';
import { afterEach, describe, expect, it } from 'vitest';
import { SqliteDeadLetterStore } from './dead-letters.js';
import { openEventDatabase } from './schema.js';

const LETTER = {
  subscription: 'seam:verdicts',
  globalSeq: 7,
  error: 'InvalidPayload',
  occurredAt: '2026-07-21T12:00:00.000Z',
};

const temporaryDirectories: string[] = [];
const openDatabases: ReturnType<typeof openEventDatabase>[] = [];

function freshDatabase(): ReturnType<typeof openEventDatabase> {
  const database = openEventDatabase(':memory:');
  openDatabases.push(database);
  return database;
}

afterEach(() => {
  for (const database of openDatabases) {
    if (database.open) database.close();
  }
  openDatabases.length = 0;
  for (const directory of temporaryDirectories) {
    rmSync(directory, { recursive: true, force: true });
  }
  temporaryDirectories.length = 0;
});

describe('SqliteDeadLetterStore', () => {
  it('records and lists parked events per subscription, in position order', async () => {
    const store = new SqliteDeadLetterStore(freshDatabase());

    await store.record({ ...LETTER, globalSeq: 9 });
    await store.record(LETTER);
    await store.record({ ...LETTER, subscription: 'seam:other', globalSeq: 1 });

    const listResult = await store.list('seam:verdicts');
    const letters = listResult._unsafeUnwrap();
    expect(letters).toEqual([LETTER, { ...LETTER, globalSeq: 9 }]);
  });

  it('re-parking the same position upserts instead of failing (redelivery converges)', async () => {
    const store = new SqliteDeadLetterStore(freshDatabase());

    await store.record(LETTER);
    const again = await store.record({ ...LETTER, error: 'InvalidPayload (retry)' });

    expect(again.isOk()).toBe(true);
    const listResult2 = await store.list('seam:verdicts');
    const letters = listResult2._unsafeUnwrap();
    expect(letters).toEqual([{ ...LETTER, error: 'InvalidPayload (retry)' }]);
  });

  it('round-trips the owning stream on reactor effect letters', async () => {
    const store = new SqliteDeadLetterStore(freshDatabase());

    await store.record({ ...LETTER, subscription: 'acquisition-reactor', streamId: 'acq-1' });

    const listResult3 = await store.list('acquisition-reactor');
    const letters = listResult3._unsafeUnwrap();
    expect(letters).toEqual([
      { ...LETTER, subscription: 'acquisition-reactor', streamId: 'acq-1' },
    ]);
  });

  it('adds the stream column to a database created before it existed', async () => {
    const directory = mkdtempSync(path.join(tmpdir(), 'dead-letters-'));
    temporaryDirectories.push(directory);
    const file = path.join(directory, 'events.db');
    const legacy = new Database(file);
    legacy.exec(
      `CREATE TABLE dead_letters (
         subscription TEXT NOT NULL, global_seq INTEGER NOT NULL,
         error TEXT NOT NULL, occurred_at TEXT NOT NULL,
         PRIMARY KEY (subscription, global_seq))`,
    );
    legacy.close();

    const migrated = openEventDatabase(file);
    openDatabases.push(migrated);
    const store = new SqliteDeadLetterStore(migrated);
    await store.record({ ...LETTER, streamId: 'acq-1' });

    const listResult4 = await store.list('seam:verdicts');
    const letters = listResult4._unsafeUnwrap();
    expect(letters).toEqual([{ ...LETTER, streamId: 'acq-1' }]);
  });

  it('clears the letters of one stream without touching its neighbours', async () => {
    const store = new SqliteDeadLetterStore(freshDatabase());
    await store.record({ ...LETTER, subscription: 'acquisition-reactor', streamId: 'acq-1' });
    await store.record({
      ...LETTER,
      subscription: 'acquisition-reactor',
      globalSeq: 9,
      streamId: 'acq-2',
    });

    await store.clearStream('acquisition-reactor', 'acq-1');

    const listResult5 = await store.list('acquisition-reactor');
    const letters = listResult5._unsafeUnwrap();
    expect(letters.map((letter) => letter.streamId)).toEqual(['acq-2']);
  });

  it('prunes letters older than the retention horizon', async () => {
    const store = new SqliteDeadLetterStore(freshDatabase());
    await store.record({ ...LETTER, occurredAt: '2026-06-01T00:00:00.000Z' }); // aged out
    await store.record({ ...LETTER, globalSeq: 9, occurredAt: '2026-07-20T00:00:00.000Z' });

    await store.prune('seam:verdicts', '2026-07-01T00:00:00.000Z');

    const listResult6 = await store.list('seam:verdicts');
    const letters = listResult6._unsafeUnwrap();
    expect(letters.map((letter) => letter.globalSeq)).toEqual([9]);
  });

  describe('surfaces a faulted connection as an infra error', () => {
    it.each([
      ['record', (store: SqliteDeadLetterStore) => store.record(LETTER)],
      ['list', (store: SqliteDeadLetterStore) => store.list('seam:verdicts')],
      [
        'clearStream',
        (store: SqliteDeadLetterStore) => store.clearStream('seam:verdicts', 'acq-1'),
      ],
      [
        'prune',
        (store: SqliteDeadLetterStore) => store.prune('seam:verdicts', '2026-07-01T00:00:00.000Z'),
      ],
    ] as const)('%s', async (operation, call) => {
      const database = freshDatabase();
      const store = new SqliteDeadLetterStore(database);
      database.close();
      const result = await call(store);
      // Every one of these faults is the same closed connection, so the operation is the only
      // thing telling an operator which store call broke — and this table is the closed set.
      expect(result._unsafeUnwrapErr()).toMatchObject({
        kind: 'InfraError',
        operation: `dead-letters.${operation}`,
      });
    });
  });
});
