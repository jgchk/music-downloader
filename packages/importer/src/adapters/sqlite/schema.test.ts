import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import Database from 'better-sqlite3';
import { afterEach, describe, expect, it } from 'vitest';
import { SqliteDeadLetterStore } from './dead-letters.js';
import { openEventDatabase } from './schema.js';

const dirs: string[] = [];
afterEach(() => {
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

function tempDbFile(): string {
  const dir = mkdtempSync(join(tmpdir(), 'importer-schema-'));
  dirs.push(dir);
  return join(dir, 'events.db');
}

describe('openEventDatabase migration', () => {
  it('adds the dead_letters.stream_id column to a database created before it existed', async () => {
    const file = tempDbFile();
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

    const db = openEventDatabase(file);
    const columns = db.pragma('table_info(dead_letters)') as { name: string }[];
    expect(columns.some((column) => column.name === 'stream_id')).toBe(true);
    // The pre-existing row survives the migration with a null stream_id.
    expect(db.prepare('SELECT stream_id FROM dead_letters').get()).toEqual({ stream_id: null });

    // The migrated column is actually usable: a reactor letter carrying a stream_id round-trips.
    const store = new SqliteDeadLetterStore(db);
    (
      await store.record({
        subscription: 'import-reactor',
        globalSeq: 2,
        error: 'Propose: bridge.propose: down',
        occurredAt: '2026-07-22T12:00:00.000Z',
        streamId: 'imp-1',
      })
    )._unsafeUnwrap();
    expect((await store.list('import-reactor'))._unsafeUnwrap()).toEqual([
      {
        subscription: 'import-reactor',
        globalSeq: 2,
        error: 'Propose: bridge.propose: down',
        occurredAt: '2026-07-22T12:00:00.000Z',
        streamId: 'imp-1',
      },
    ]);
    db.close();
  });
});
