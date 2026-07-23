import { afterEach, describe, expect, it } from 'vitest';
import { fixedClock } from '../../application/__fixtures__/fakes.js';
import type { SourceResource } from '../../application/ports/resource-ledger-port.js';
import { SqliteResourceLedger } from './resource-ledger.js';
import { openEventDatabase, type EventDatabase } from './schema.js';

const transfer: SourceResource = {
  source: 'slskd',
  kind: 'transfer',
  resourceKey: String.raw`u1|@@a\Album\01.flac`,
  acquisitionId: 'acq-1',
};

const openDbs: EventDatabase[] = [];

function ledger(): { db: EventDatabase; store: SqliteResourceLedger } {
  const database = openEventDatabase(':memory:');
  openDbs.push(database);
  return { db: database, store: new SqliteResourceLedger(database, fixedClock()) };
}

afterEach(() => {
  for (const database of openDbs) if (database.open) database.close();
  openDbs.length = 0;
});

describe('SqliteResourceLedger', () => {
  it('records a created resource and lists it as live for its acquisition', async () => {
    const { store } = ledger();
    const recordCreatedResult = await store.recordCreated(transfer);
    recordCreatedResult._unsafeUnwrap();
    const liveByAcquisitionResult = await store.liveByAcquisition('acq-1');
    expect(liveByAcquisitionResult._unsafeUnwrap()).toEqual([transfer]);
  });

  it('records without an id, then attaches the source-assigned id', async () => {
    const { store } = ledger();
    await store.recordCreated(transfer);
    const recordIdResult = await store.recordId(transfer, 'guid-9');
    recordIdResult._unsafeUnwrap();
    const liveByAcquisitionResult2 = await store.liveByAcquisition('acq-1');
    expect(liveByAcquisitionResult2._unsafeUnwrap()).toEqual([
      { ...transfer, resourceId: 'guid-9' },
    ]);
  });

  it('is insert-if-absent: a repeated recording neither duplicates nor clobbers a captured id', async () => {
    const { store } = ledger();
    await store.recordCreated(transfer);
    await store.recordId(transfer, 'guid-9');
    await store.recordCreated(transfer); // a crash-replayed write-ahead recording
    const liveByAcquisitionResult3 = await store.liveByAcquisition('acq-1');
    expect(liveByAcquisitionResult3._unsafeUnwrap()).toEqual([
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
    const liveByAcquisitionResult4 = await store.liveByAcquisition('acq-1');
    expect(liveByAcquisitionResult4._unsafeUnwrap()).toEqual([search]);
  });

  it('excludes a removed resource from both live queries', async () => {
    const { store } = ledger();
    await store.recordCreated(transfer);
    const markRemovedResult = await store.markRemoved(transfer);
    markRemovedResult._unsafeUnwrap();
    const liveByAcquisitionResult5 = await store.liveByAcquisition('acq-1');
    expect(liveByAcquisitionResult5._unsafeUnwrap()).toEqual([]);
    const allLiveResult = await store.allLive();
    expect(allLiveResult._unsafeUnwrap()).toEqual([]);
  });

  it('scopes live queries by acquisition, and all-live across acquisitions', async () => {
    const { store } = ledger();
    const other: SourceResource = { ...transfer, acquisitionId: 'acq-2', resourceKey: 'u2|x' };
    await store.recordCreated(transfer);
    await store.recordCreated(other);
    const liveByAcquisitionResult6 = await store.liveByAcquisition('acq-1');
    expect(liveByAcquisitionResult6._unsafeUnwrap()).toEqual([transfer]);
    const allLiveResult2 = await store.allLive();
    const all = allLiveResult2._unsafeUnwrap();
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
