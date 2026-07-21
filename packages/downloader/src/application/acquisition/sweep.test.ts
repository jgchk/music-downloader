import { errAsync, okAsync } from 'neverthrow';
import { beforeEach, describe, expect, it } from 'vitest';
import { SourceResourceSweep } from './sweep.js';
import { FakeEventStore, FakeResourceLedger, silentLogger } from '../__fixtures__/fakes.js';
import { infraError } from '../ports/errors.js';
import type { SourceResource, SourceResourceRemover } from '../ports/resource-ledger-port.js';
import {
  matchingCandidate,
  selectedHistory,
} from '../../domain/acquisition/__fixtures__/acquisition-fixtures.js';

const resource = (acquisitionId: string): SourceResource => ({
  source: 'slskd',
  kind: 'transfer',
  resourceKey: `u1|f-${acquisitionId}`,
  acquisitionId,
});

/**
 * A remover that records what it removed and can be told to fail (an infra fault) or to report a
 * record as *not confirmed gone* (`unconfirmed`) for specific acquisitions.
 */
function fakeRemover(): SourceResourceRemover & {
  removed: SourceResource[];
  fail: Set<string>;
  unconfirmed: Set<string>;
} {
  const removed: SourceResource[] = [];
  const fail = new Set<string>();
  const unconfirmed = new Set<string>();
  return {
    removed,
    fail,
    unconfirmed,
    remove(target: SourceResource) {
      if (fail.has(target.acquisitionId)) return errAsync(infraError('remove', 'boom'));
      if (unconfirmed.has(target.acquisitionId)) return okAsync(false);
      removed.push(target);
      return okAsync(true);
    },
  };
}

let store: FakeEventStore;
let ledger: FakeResourceLedger;

beforeEach(() => {
  store = new FakeEventStore();
  ledger = new FakeResourceLedger();
});

async function seed(acquisitionId: string, terminal: boolean): Promise<void> {
  const a = matchingCandidate('a');
  const history = terminal
    ? [...selectedHistory([a]), { type: 'AcquisitionCancelled' as const }]
    : selectedHistory([a]);
  await store.append(acquisitionId, 0, history, { acquisitionId, occurredAt: 't' });
  await ledger.recordCreated(resource(acquisitionId));
}

function sweep(remover: SourceResourceRemover): SourceResourceSweep {
  return new SourceResourceSweep({ ledger, remover, store, logger: silentLogger() });
}

async function liveAcquisitionIds(): Promise<string[]> {
  return (await ledger.allLive())._unsafeUnwrap().map((r) => r.acquisitionId);
}

describe('SourceResourceSweep', () => {
  it("removes a terminal acquisition's resource and marks it removed", async () => {
    await seed('acq-done', true);
    const remover = fakeRemover();

    await sweep(remover).run();

    expect(remover.removed.map((r) => r.acquisitionId)).toEqual(['acq-done']);
    expect(await liveAcquisitionIds()).toEqual([]);
  });

  it("leaves an in-flight acquisition's resource untouched", async () => {
    await seed('acq-live', false);
    const remover = fakeRemover();

    await sweep(remover).run();

    expect(remover.removed).toEqual([]);
    expect(await liveAcquisitionIds()).toEqual(['acq-live']);
  });

  it('isolates a per-row removal failure and still processes the rest', async () => {
    await seed('acq-a', true);
    await seed('acq-b', true);
    const remover = fakeRemover();
    remover.fail.add('acq-a');

    await sweep(remover).run();

    // acq-a's removal failed so its row stays live; acq-b was removed and marked.
    expect(remover.removed.map((r) => r.acquisitionId)).toEqual(['acq-b']);
    expect(await liveAcquisitionIds()).toEqual(['acq-a']);
  });

  it('leaves a row live when its record is not yet confirmed gone', async () => {
    await seed('acq-lingering', true);
    const remover = fakeRemover();
    remover.unconfirmed.add('acq-lingering');

    await sweep(remover).run();

    // The cancelled record has not transitioned to removable — its row stays live for the next boot.
    expect(remover.removed).toEqual([]);
    expect(await liveAcquisitionIds()).toEqual(['acq-lingering']);
  });

  it('logs and stops when the ledger cannot be read', async () => {
    ledger.fail = true;
    const remover = fakeRemover();

    await sweep(remover).run(); // must not throw

    expect(remover.removed).toEqual([]);
  });

  it('skips a row whose terminal check fails', async () => {
    await ledger.recordCreated(resource('acq-unreadable'));
    store.failReads = true;
    const remover = fakeRemover();

    await sweep(remover).run();

    expect(remover.removed).toEqual([]);
  });

  it('tolerates a markRemoved failure after the source removal succeeds', async () => {
    await seed('acq-done', true);
    ledger.failMarkRemoved = true;
    const remover = fakeRemover();

    await sweep(remover).run();

    // The resource was removed from the source even though the ledger write failed.
    expect(remover.removed.map((r) => r.acquisitionId)).toEqual(['acq-done']);
  });
});
