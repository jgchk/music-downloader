import { describe, expect, it } from 'vitest';
import { FakeResourceLedger, silentLogger } from '../../application/__fixtures__/fakes.js';
import type { SourceResource } from '../../application/ports/resource-ledger-port.js';
import { TransferLedger } from './transfer-ledger.js';

const ACQ = 'acq-1';
const USER = 'u1';
const FIRST = String.raw`@@a\Album\01.flac`;
const SECOND = String.raw`@@a\Album\02.flac`;
const WANTED: ReadonlySet<string> = new Set([FIRST, SECOND]);

function ledgerFor(): { store: FakeResourceLedger; transfers: TransferLedger } {
  const store = new FakeResourceLedger();
  return { store, transfers: new TransferLedger(silentLogger(), store) };
}

/** A live ledger row, spelled out field by field so each near-miss below differs in exactly one. */
function row(overrides: Partial<SourceResource> = {}): SourceResource {
  return {
    source: 'slskd',
    kind: 'transfer',
    resourceKey: `${USER}|${FIRST}`,
    acquisitionId: ACQ,
    ...overrides,
  };
}

describe('TransferLedger', () => {
  it('re-reads the write-ahead rows it recorded for the download', async () => {
    // The round trip that reconciliation depends on: rows are written under `keyFor`'s key and read
    // back by the same class. A key shape that drifts between the two makes a crashed attempt's
    // transfers invisible on restart, and the candidate is silently downloaded a second time.
    const { transfers } = ledgerFor();
    await transfers.recordCreated([
      transfers.keyFor(ACQ, USER, FIRST),
      transfers.keyFor(ACQ, USER, SECOND),
    ]);

    const live = await transfers.liveTransferFilenames(ACQ, USER, WANTED);

    expect([...live]).toEqual([FIRST, SECOND]);
  });

  it('reports only the wanted transfer rows this peer owns', async () => {
    // Everything else in the download's ledger is a near-miss on exactly one field, and each one
    // would be a different candidate's or a different source's business if it were read as ours.
    const { store, transfers } = ledgerFor();
    store.created.push(
      row(),
      row({ source: 'another-source', resourceKey: `${USER}|${SECOND}` }),
      row({ kind: 'search', resourceKey: `${USER}|${SECOND}` }),
      row({ resourceKey: `u2|${SECOND}` }),
      row({ resourceKey: String.raw`u1|@@a\Album\99.flac` }),
    );

    const live = await transfers.liveTransferFilenames(ACQ, USER, WANTED);

    expect([...live]).toEqual([FIRST]);
  });

  it('reports no prior attempt when the ledger cannot be read', async () => {
    // Reconciliation degrades to a plain enqueue rather than failing the download outright.
    const { store, transfers } = ledgerFor();
    store.created.push(row());
    store.fail = true;

    const live = await transfers.liveTransferFilenames(ACQ, USER, WANTED);

    expect([...live]).toEqual([]);
  });
});
