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

    expect((await store.find(3))._unsafeUnwrap()).toEqual(ENTRY);
    expect((await store.find(4))._unsafeUnwrap()).toBeUndefined();
  });

  it('re-parking the same position upserts the tally (one park per held event)', async () => {
    const store = new SqliteParkedEffectStore(openEventDatabase(':memory:'));

    await store.park(ENTRY);
    await store.park({ ...ENTRY, attempt: 2, lastError: 'bridge.propose: still failing' });

    const found = (await store.find(3))._unsafeUnwrap();
    expect(found?.attempt).toBe(2);
    expect(found?.lastError).toBe('bridge.propose: still failing');
  });

  it('clears an entry on success and clearing an absent position is a no-op', async () => {
    const store = new SqliteParkedEffectStore(openEventDatabase(':memory:'));
    await store.park(ENTRY);

    expect((await store.clear(3)).isOk()).toBe(true);
    expect((await store.clear(999)).isOk()).toBe(true);

    expect((await store.find(3))._unsafeUnwrap()).toBeUndefined();
  });

  it('surfaces storage faults as infra errors', async () => {
    const db = openEventDatabase(':memory:');
    const store = new SqliteParkedEffectStore(db);
    db.close();

    expect((await store.park(ENTRY)).isErr()).toBe(true);
    expect((await store.find(3)).isErr()).toBe(true);
    expect((await store.clear(3)).isErr()).toBe(true);
  });
});
