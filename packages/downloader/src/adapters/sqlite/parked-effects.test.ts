import { describe, expect, it } from 'vitest';
import { SqliteParkedEffectStore } from './parked-effects.js';
import { openEventDatabase } from './schema.js';

const ENTRY = {
  streamId: 'acq-1',
  globalSeq: 3,
  attempt: 1,
  parkedAt: '2026-07-22T12:00:00.000Z',
  nextRetryAt: '2026-07-22T12:00:05.000Z',
  lastError: 'mb: down',
};

describe('SqliteParkedEffectStore', () => {
  it('parks an entry and finds it by stream', async () => {
    const store = new SqliteParkedEffectStore(openEventDatabase(':memory:'));

    await store.park(ENTRY);

    expect((await store.find('acq-1'))._unsafeUnwrap()).toEqual(ENTRY);
    expect((await store.find('acq-2'))._unsafeUnwrap()).toBeUndefined();
  });

  it('re-parking the same stream upserts the scheduling state (one park per stream)', async () => {
    const store = new SqliteParkedEffectStore(openEventDatabase(':memory:'));

    await store.park(ENTRY);
    await store.park({
      ...ENTRY,
      attempt: 2,
      nextRetryAt: '2026-07-22T12:00:15.000Z',
      lastError: 'mb: still down',
    });

    const found = (await store.find('acq-1'))._unsafeUnwrap();
    expect(found?.attempt).toBe(2);
    expect(found?.nextRetryAt).toBe('2026-07-22T12:00:15.000Z');
  });

  it('lists only entries due at the given instant, oldest scheduling first', async () => {
    const store = new SqliteParkedEffectStore(openEventDatabase(':memory:'));
    await store.park({ ...ENTRY, streamId: 'acq-later', nextRetryAt: '2026-07-22T13:00:00.000Z' });
    await store.park({ ...ENTRY, streamId: 'acq-due-2', nextRetryAt: '2026-07-22T12:00:05.000Z' });
    await store.park({ ...ENTRY, streamId: 'acq-due-1', nextRetryAt: '2026-07-22T12:00:01.000Z' });

    const due = (await store.due('2026-07-22T12:30:00.000Z'))._unsafeUnwrap();

    expect(due.map((entry) => entry.streamId)).toEqual(['acq-due-1', 'acq-due-2']);
  });

  it('clears an entry on success and clearing an absent stream is a no-op', async () => {
    const store = new SqliteParkedEffectStore(openEventDatabase(':memory:'));
    await store.park(ENTRY);

    expect((await store.clear('acq-1')).isOk()).toBe(true);
    expect((await store.clear('acq-never-parked')).isOk()).toBe(true);

    expect((await store.find('acq-1'))._unsafeUnwrap()).toBeUndefined();
    expect((await store.due('2026-07-23T00:00:00.000Z'))._unsafeUnwrap()).toEqual([]);
  });

  it('surfaces storage faults as infra errors', async () => {
    const db = openEventDatabase(':memory:');
    const store = new SqliteParkedEffectStore(db);
    db.close();

    expect((await store.park(ENTRY)).isErr()).toBe(true);
    expect((await store.find('acq-1')).isErr()).toBe(true);
    expect((await store.due('2026-07-23T00:00:00.000Z')).isErr()).toBe(true);
    expect((await store.clear('acq-1')).isErr()).toBe(true);
  });
});
