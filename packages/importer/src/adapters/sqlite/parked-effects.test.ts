import { describe, expect, it } from 'vitest';
import { SqliteParkedEffectStore } from './parked-effects.js';
import { openEventDatabase } from './schema.js';

const ENTRY = {
  globalSeq: 3,
  streamId: 'imp-1',
  attempt: 1,
  parkedAt: '2026-07-22T12:00:00.000Z',
  lastError: 'bridge.propose: spawn failed',
};

describe('SqliteParkedEffectStore', () => {
  it('parks an entry and finds it by global position', async () => {
    const store = new SqliteParkedEffectStore(openEventDatabase(':memory:'));

    await store.park(ENTRY);

    const findResult = await store.find(3);
    expect(findResult._unsafeUnwrap()).toEqual(ENTRY);
    const findResult2 = await store.find(4);
    expect(findResult2._unsafeUnwrap()).toBeUndefined();
  });

  it('re-parking the same position upserts the tally (one park per held event)', async () => {
    const store = new SqliteParkedEffectStore(openEventDatabase(':memory:'));

    await store.park(ENTRY);
    await store.park({ ...ENTRY, attempt: 2, lastError: 'bridge.propose: still failing' });

    const findResult3 = await store.find(3);
    const found = findResult3._unsafeUnwrap();
    expect(found?.attempt).toBe(2);
    expect(found?.lastError).toBe('bridge.propose: still failing');
  });

  it('clears an entry on success and clearing an absent position is a no-op', async () => {
    const store = new SqliteParkedEffectStore(openEventDatabase(':memory:'));
    await store.park(ENTRY);

    const clearResult = await store.clear(3);
    expect(clearResult.isOk()).toBe(true);
    const clearResult2 = await store.clear(999);
    expect(clearResult2.isOk()).toBe(true);

    const findResult4 = await store.find(3);
    expect(findResult4._unsafeUnwrap()).toBeUndefined();
  });

  it('surfaces storage faults as infra errors', async () => {
    const database = openEventDatabase(':memory:');
    const store = new SqliteParkedEffectStore(database);
    database.close();

    const parkResult = await store.park(ENTRY);
    expect(parkResult.isErr()).toBe(true);
    const findResult5 = await store.find(3);
    expect(findResult5.isErr()).toBe(true);
    const clearResult3 = await store.clear(3);
    expect(clearResult3.isErr()).toBe(true);
  });
});
