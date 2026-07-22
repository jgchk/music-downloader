import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import Database from 'better-sqlite3';
import { describe, expect, it } from 'vitest';
import { SqliteDeadLetterStore } from './dead-letters.js';
import { openEventDatabase } from './schema.js';

const LETTER = {
  subscription: 'seam:verdicts',
  globalSeq: 7,
  error: 'InvalidPayload',
  occurredAt: '2026-07-21T12:00:00.000Z',
};

describe('SqliteDeadLetterStore', () => {
  it('records and lists parked events per subscription, in position order', async () => {
    const store = new SqliteDeadLetterStore(openEventDatabase(':memory:'));

    await store.record({ ...LETTER, globalSeq: 9 });
    await store.record(LETTER);
    await store.record({ ...LETTER, subscription: 'seam:other', globalSeq: 1 });

    const letters = (await store.list('seam:verdicts'))._unsafeUnwrap();
    expect(letters).toEqual([LETTER, { ...LETTER, globalSeq: 9 }]);
  });

  it('re-parking the same position upserts instead of failing (redelivery converges)', async () => {
    const store = new SqliteDeadLetterStore(openEventDatabase(':memory:'));

    await store.record(LETTER);
    const again = await store.record({ ...LETTER, error: 'InvalidPayload (retry)' });

    expect(again.isOk()).toBe(true);
    const letters = (await store.list('seam:verdicts'))._unsafeUnwrap();
    expect(letters).toEqual([{ ...LETTER, error: 'InvalidPayload (retry)' }]);
  });

  it('round-trips the owning stream on reactor effect letters', async () => {
    const store = new SqliteDeadLetterStore(openEventDatabase(':memory:'));

    await store.record({ ...LETTER, subscription: 'acquisition-reactor', streamId: 'acq-1' });

    const letters = (await store.list('acquisition-reactor'))._unsafeUnwrap();
    expect(letters).toEqual([
      { ...LETTER, subscription: 'acquisition-reactor', streamId: 'acq-1' },
    ]);
  });

  it('adds the stream column to a database created before it existed', async () => {
    const file = join(mkdtempSync(join(tmpdir(), 'dead-letters-')), 'events.db');
    const legacy = new Database(file);
    legacy.exec(
      `CREATE TABLE dead_letters (
         subscription TEXT NOT NULL, global_seq INTEGER NOT NULL,
         error TEXT NOT NULL, occurred_at TEXT NOT NULL,
         PRIMARY KEY (subscription, global_seq))`,
    );
    legacy.close();

    const store = new SqliteDeadLetterStore(openEventDatabase(file));
    await store.record({ ...LETTER, streamId: 'acq-1' });

    const letters = (await store.list('seam:verdicts'))._unsafeUnwrap();
    expect(letters).toEqual([{ ...LETTER, streamId: 'acq-1' }]);
  });

  it('surfaces storage faults as infra errors', async () => {
    const db = openEventDatabase(':memory:');
    const store = new SqliteDeadLetterStore(db);
    db.close();

    expect((await store.record(LETTER)).isErr()).toBe(true);
    expect((await store.list('seam:verdicts')).isErr()).toBe(true);
  });
});
