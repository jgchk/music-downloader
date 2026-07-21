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

  it('surfaces storage faults as infra errors', async () => {
    const db = openEventDatabase(':memory:');
    const store = new SqliteDeadLetterStore(db);
    db.close();

    expect((await store.record(LETTER)).isErr()).toBe(true);
    expect((await store.list('seam:verdicts')).isErr()).toBe(true);
  });
});
