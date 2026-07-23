import { describe, expect, it } from 'vitest';
import { SqliteDeadLetterStore } from './dead-letters.js';
import { openEventDatabase } from './schema.js';

const LETTER = {
  subscription: 'seam:acquisitions',
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

    const letters = (await store.list('seam:acquisitions'))._unsafeUnwrap();
    expect(letters).toEqual([LETTER, { ...LETTER, globalSeq: 9 }]);
  });

  it('re-parking the same position upserts instead of failing (redelivery converges)', async () => {
    const store = new SqliteDeadLetterStore(openEventDatabase(':memory:'));

    await store.record(LETTER);
    const again = await store.record({ ...LETTER, error: 'InvalidPayload (retry)' });

    expect(again.isOk()).toBe(true);
    const letters = (await store.list('seam:acquisitions'))._unsafeUnwrap();
    expect(letters).toEqual([{ ...LETTER, error: 'InvalidPayload (retry)' }]);
  });

  it('round-trips a reactor letter carrying its owning stream, and clears by stream', async () => {
    const store = new SqliteDeadLetterStore(openEventDatabase(':memory:'));
    const reactorLetter = { ...LETTER, subscription: 'import-reactor', streamId: 'imp-1' };

    await store.record(reactorLetter);
    expect((await store.list('import-reactor'))._unsafeUnwrap()).toEqual([reactorLetter]);

    expect((await store.clearStream('import-reactor', 'imp-1')).isOk()).toBe(true);
    expect((await store.clearStream('import-reactor', 'imp-absent')).isOk()).toBe(true); // no-op
    expect((await store.list('import-reactor'))._unsafeUnwrap()).toEqual([]);
  });

  it('scopes clearStream to its subscription — another subscription’s same-stream letter survives', async () => {
    const store = new SqliteDeadLetterStore(openEventDatabase(':memory:'));
    await store.record({ ...LETTER, subscription: 'import-reactor', streamId: 'imp-1' });
    const bystander = { ...LETTER, subscription: 'seam:acquisitions', streamId: 'imp-1' };
    await store.record(bystander);

    await store.clearStream('import-reactor', 'imp-1');

    expect((await store.list('import-reactor'))._unsafeUnwrap()).toEqual([]);
    expect((await store.list('seam:acquisitions'))._unsafeUnwrap()).toEqual([bystander]);
  });

  it('prunes letters older than the retention horizon, keeping newer ones', async () => {
    const store = new SqliteDeadLetterStore(openEventDatabase(':memory:'));
    await store.record({ ...LETTER, globalSeq: 1, occurredAt: '2026-06-01T00:00:00.000Z' });
    await store.record({ ...LETTER, globalSeq: 2, occurredAt: '2026-07-21T12:00:00.000Z' });

    await store.prune('seam:acquisitions', '2026-07-01T00:00:00.000Z');

    const letters = (await store.list('seam:acquisitions'))._unsafeUnwrap();
    expect(letters.map((entry) => entry.globalSeq)).toEqual([2]);
  });

  it('scopes prune to its subscription — another subscription’s aged letters are untouched', async () => {
    const store = new SqliteDeadLetterStore(openEventDatabase(':memory:'));
    // The reactor's boot-time retention prune of 'import-reactor' must never touch the seam's letters.
    const seamAged = {
      ...LETTER,
      subscription: 'seam:acquisitions',
      occurredAt: '2026-06-01T00:00:00.000Z',
    };
    await store.record(seamAged);
    await store.record({
      ...LETTER,
      subscription: 'import-reactor',
      occurredAt: '2026-06-01T00:00:00.000Z',
    });

    await store.prune('import-reactor', '2026-07-01T00:00:00.000Z');

    expect((await store.list('import-reactor'))._unsafeUnwrap()).toEqual([]);
    expect((await store.list('seam:acquisitions'))._unsafeUnwrap()).toEqual([seamAged]);
  });

  it('surfaces storage faults as infra errors', async () => {
    const db = openEventDatabase(':memory:');
    const store = new SqliteDeadLetterStore(db);
    db.close();

    expect((await store.record(LETTER)).isErr()).toBe(true);
    expect((await store.list('seam:acquisitions')).isErr()).toBe(true);
    expect((await store.clearStream('import-reactor', 'imp-1')).isErr()).toBe(true);
    expect((await store.prune('seam:acquisitions', '2026-07-01T00:00:00.000Z')).isErr()).toBe(true);
  });
});
