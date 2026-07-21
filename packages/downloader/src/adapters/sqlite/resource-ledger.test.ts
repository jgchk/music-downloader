import { afterEach, describe, expect, it } from 'vitest';
import { fixedClock } from '../../application/__fixtures__/fakes.js';
import type { SourceResource } from '../../application/ports/resource-ledger-port.js';
import { SqliteResourceLedger } from './resource-ledger.js';
import { openEventDatabase, type EventDatabase } from './schema.js';

const transfer: SourceResource = {
  source: 'slskd',
  kind: 'transfer',
  resourceKey: 'u1|@@a\\Album\\01.flac',
  acquisitionId: 'acq-1',
};

const openDbs: EventDatabase[] = [];

function ledger(): { db: EventDatabase; store: SqliteResourceLedger } {
  const db = openEventDatabase(':memory:');
  openDbs.push(db);
  return { db, store: new SqliteResourceLedger(db, fixedClock()) };
}

afterEach(() => {
  for (const db of openDbs.splice(0)) if (db.open) db.close();
});

describe('SqliteResourceLedger', () => {
  it('records a created resource and lists it as live for its acquisition', async () => {
    const { store } = ledger();
    (await store.recordCreated(transfer))._unsafeUnwrap();
    expect((await store.liveByAcquisition('acq-1'))._unsafeUnwrap()).toEqual([transfer]);
  });

  it('records without an id, then attaches the source-assigned id', async () => {
    const { store } = ledger();
    await store.recordCreated(transfer);
    (await store.recordId(transfer, 'guid-9'))._unsafeUnwrap();
    expect((await store.liveByAcquisition('acq-1'))._unsafeUnwrap()).toEqual([
      { ...transfer, resourceId: 'guid-9' },
    ]);
  });

  it('is insert-if-absent: a repeated recording neither duplicates nor clobbers a captured id', async () => {
    const { store } = ledger();
    await store.recordCreated(transfer);
    await store.recordId(transfer, 'guid-9');
    await store.recordCreated(transfer); // a crash-replayed write-ahead recording
    expect((await store.liveByAcquisition('acq-1'))._unsafeUnwrap()).toEqual([
      { ...transfer, resourceId: 'guid-9' },
    ]);
  });

  it('preserves an id supplied at creation (a search learns its id immediately)', async () => {
    const { store } = ledger();
    const search: SourceResource = {
      source: 'slskd',
      kind: 'search',
      resourceKey: 'search-1',
      resourceId: 'search-1',
      acquisitionId: 'acq-1',
    };
    await store.recordCreated(search);
    expect((await store.liveByAcquisition('acq-1'))._unsafeUnwrap()).toEqual([search]);
  });

  it('excludes a removed resource from both live queries', async () => {
    const { store } = ledger();
    await store.recordCreated(transfer);
    (await store.markRemoved(transfer))._unsafeUnwrap();
    expect((await store.liveByAcquisition('acq-1'))._unsafeUnwrap()).toEqual([]);
    expect((await store.allLive())._unsafeUnwrap()).toEqual([]);
  });

  it('scopes live queries by acquisition, and all-live across acquisitions', async () => {
    const { store } = ledger();
    const other: SourceResource = { ...transfer, acquisitionId: 'acq-2', resourceKey: 'u2|x' };
    await store.recordCreated(transfer);
    await store.recordCreated(other);
    expect((await store.liveByAcquisition('acq-1'))._unsafeUnwrap()).toEqual([transfer]);
    const all = (await store.allLive())._unsafeUnwrap();
    expect(all).toHaveLength(2);
    expect(all).toEqual(expect.arrayContaining([transfer, other]));
  });

  describe('surfaces a faulted connection as an InfraError', () => {
    it.each([
      ['recordCreated', (s: SqliteResourceLedger) => s.recordCreated(transfer)],
      ['recordId', (s: SqliteResourceLedger) => s.recordId(transfer, 'g')],
      ['markRemoved', (s: SqliteResourceLedger) => s.markRemoved(transfer)],
      ['liveByAcquisition', (s: SqliteResourceLedger) => s.liveByAcquisition('acq-1')],
      ['allLive', (s: SqliteResourceLedger) => s.allLive()],
    ] as const)('%s', async (op, call) => {
      const { db, store } = ledger();
      db.close();
      const result = await call(store);
      expect(result._unsafeUnwrapErr()).toMatchObject({
        kind: 'InfraError',
        operation: `resource-ledger.${op}`,
      });
    });
  });
});
