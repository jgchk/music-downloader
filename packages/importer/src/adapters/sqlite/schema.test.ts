import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import Database from 'better-sqlite3';
import { afterEach, describe, expect, it } from 'vitest';
import { SqliteDeadLetterStore } from './dead-letters.js';
import { openEventDatabase } from './schema.js';

const directories: string[] = [];
afterEach(() => {
  for (const directory of directories) rmSync(directory, { recursive: true, force: true });
  directories.length = 0;
});

function temporaryDatabaseFile(): string {
  const directory = mkdtempSync(path.join(tmpdir(), 'importer-schema-'));
  directories.push(directory);
  return path.join(directory, 'events.db');
}

describe('openEventDatabase migration', () => {
  it('adds the dead_letters.stream_id column to a database created before it existed', async () => {
    const file = temporaryDatabaseFile();
    // A legacy database: dead_letters without the stream_id column, carrying an existing row.
    const legacy = new Database(file);
    legacy.exec(
      `CREATE TABLE dead_letters (
         subscription TEXT NOT NULL,
         global_seq INTEGER NOT NULL,
         error TEXT NOT NULL,
         occurred_at TEXT NOT NULL,
         PRIMARY KEY (subscription, global_seq)
       );
       INSERT INTO dead_letters (subscription, global_seq, error, occurred_at)
       VALUES ('seam:acquisitions', 1, 'legacy', '2026-06-01T00:00:00.000Z');`,
    );
    legacy.close();

    const database = openEventDatabase(file);
    const columns = database.pragma('table_info(dead_letters)') as { name: string }[];
    expect(columns.some((column) => column.name === 'stream_id')).toBe(true);
    // The pre-existing row survives the migration with a null stream_id.
    expect(database.prepare('SELECT stream_id FROM dead_letters').get()).toEqual({
      stream_id: null,
    });

    // The migrated column is actually usable: a reactor letter carrying a stream_id round-trips.
    const store = new SqliteDeadLetterStore(database);
    const recordResult = await store.record({
      subscription: 'import-reactor',
      globalSeq: 2,
      error: 'Propose: bridge.propose: down',
      occurredAt: '2026-07-22T12:00:00.000Z',
      streamId: 'imp-1',
    });
    recordResult._unsafeUnwrap();
    const listResult = await store.list('import-reactor');
    expect(listResult._unsafeUnwrap()).toEqual([
      {
        subscription: 'import-reactor',
        globalSeq: 2,
        error: 'Propose: bridge.propose: down',
        occurredAt: '2026-07-22T12:00:00.000Z',
        streamId: 'imp-1',
      },
    ]);
    database.close();
  });
});
