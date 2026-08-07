import { fixedClock } from '../__fixtures__/fakes.js';
import { appendMetadata } from '../__fixtures__/correlation.js';
import { errAsync, okAsync } from 'neverthrow';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { SourceResourceSweep } from './sweep.js';
import { FakeEventStore, FakeResourceLedger, silentLogger } from '../__fixtures__/fakes.js';
import type { Logger } from '../logging/logger.js';
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

async function seed(acquisitionId: string, isTerminal: boolean): Promise<void> {
  const a = matchingCandidate('a');
  const history = isTerminal
    ? [...selectedHistory([a]), { type: 'AcquisitionCancelled' as const }]
    : selectedHistory([a]);
  await store.append(acquisitionId, 0, history, appendMetadata(acquisitionId, fixedClock()));
  await ledger.recordCreated(resource(acquisitionId));
}

function sweep(
  remover: SourceResourceRemover,
  logger: Logger = silentLogger(),
): SourceResourceSweep {
  return new SourceResourceSweep({ ledger, remover, store, logger });
}

async function liveAcquisitionIds(): Promise<string[]> {
  const allLiveResult = await ledger.allLive();
  return allLiveResult._unsafeUnwrap().map((r) => r.acquisitionId);
}

describe('SourceResourceSweep', () => {
  it("removes a terminal acquisition's resource and marks it removed", async () => {
    await seed('acq-done', true);
    const remover = fakeRemover();
    const logger = silentLogger();
    const warn = vi.spyOn(logger, 'warn');
    const error = vi.spyOn(logger, 'error');

    await sweep(remover, logger).run();

    expect(remover.removed.map((r) => r.acquisitionId)).toEqual(['acq-done']);
    expect(await liveAcquisitionIds()).toEqual([]);
    // A sweep that converged reports nothing: every line this pass can emit names a row the next
    // boot must retry, so an operator reading one on a clean sweep would chase a row that is gone.
    expect(warn).not.toHaveBeenCalled();
    expect(error).not.toHaveBeenCalled();
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
    const logger = silentLogger();
    const warn = vi.spyOn(logger, 'warn');

    await sweep(remover, logger).run();

    // acq-a's removal failed so its row stays live; acq-b was removed and marked.
    expect(remover.removed.map((r) => r.acquisitionId)).toEqual(['acq-b']);
    expect(await liveAcquisitionIds()).toEqual(['acq-a']);
    // A faulted source and a record that is merely lingering both leave the row live, so the
    // report is the only thing telling an operator which of the two they are looking at.
    expect(warn).toHaveBeenCalledWith(
      { err: infraError('remove', 'boom'), acquisitionId: 'acq-a' },
      'sweep: source removal failed; will retry next boot',
    );
  });

  it('leaves a row live when its record is not yet confirmed gone', async () => {
    await seed('acq-lingering', true);
    const remover = fakeRemover();
    remover.unconfirmed.add('acq-lingering');
    const logger = silentLogger();
    const warn = vi.spyOn(logger, 'warn');

    await sweep(remover, logger).run();

    // The cancelled record has not transitioned to removable — its row stays live for the next boot.
    expect(remover.removed).toEqual([]);
    expect(await liveAcquisitionIds()).toEqual(['acq-lingering']);
    // An expected wait, not a fault: this row must not be reported as a failed removal.
    expect(warn).not.toHaveBeenCalled();
  });

  it('logs and stops when the ledger cannot be read', async () => {
    ledger.fail = true;
    const remover = fakeRemover();

    await sweep(remover).run(); // must not throw

    expect(remover.removed).toEqual([]);
  });

  it('skips a row whose terminal check fails, and says which row it skipped', async () => {
    await ledger.recordCreated(resource('acq-unreadable'));
    store.failReads = true;
    const remover = fakeRemover();
    const logger = silentLogger();
    const error = vi.spyOn(logger, 'error');

    await sweep(remover, logger).run();

    expect(remover.removed).toEqual([]);
    // The row survives the boot untouched, so nothing else will ever mention it: skipping it
    // silently would leave an owed removal invisible until someone read the ledger by hand.
    expect(error).toHaveBeenCalledWith(
      { err: infraError('readStream', 'boom'), acquisitionId: 'acq-unreadable' },
      'sweep: terminal check failed',
    );
  });

  it('tolerates a markRemoved failure after the source removal succeeds', async () => {
    await seed('acq-done', true);
    ledger.failMarkRemoved = true;
    const remover = fakeRemover();
    const logger = silentLogger();
    const warn = vi.spyOn(logger, 'warn');

    await sweep(remover, logger).run();

    // The resource was removed from the source even though the ledger write failed.
    expect(remover.removed.map((r) => r.acquisitionId)).toEqual(['acq-done']);
    // The row stays live, so the next boot will try to remove an already-removed resource: the
    // report is what tells an operator the ledger, not the source, is the thing lagging.
    expect(warn).toHaveBeenCalledWith(
      { err: infraError('resource-ledger.markRemoved', 'boom'), acquisitionId: 'acq-done' },
      'sweep: markRemoved failed',
    );
  });
});
