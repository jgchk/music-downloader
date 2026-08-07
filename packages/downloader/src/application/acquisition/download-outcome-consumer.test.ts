import { appendMetadata, testContext } from '../__fixtures__/correlation.js';
import { describe, expect, it } from 'vitest';
import { deliverDownloadOutcome } from './download-outcome-consumer.js';
import { FakeEventStore, fixedClock, silentLogger } from '../__fixtures__/fakes.js';
import type { AcquisitionEvent } from '../../domain/acquisition/events.js';
import {
  matchingCandidate,
  sampleFiles,
  selectedHistory,
  startedHistory,
  validatingHistory,
} from '../../domain/acquisition/__fixtures__/acquisition-fixtures.js';

/**
 * The download-outcome consumer (nonblocking-download-observation D2): the supervisor's
 * asynchronously-delivered outcome facts re-enter the decision path here, exactly as importer
 * verdicts do — translated into the existing Record* commands, with staleness absorbed and only
 * genuine infrastructure faults handed back for the supervisor's cadence retry.
 */

const candidate = matchingCandidate('a');

function consumer(store: FakeEventStore) {
  return { store, clock: fixedClock(), logger: silentLogger() };
}

async function seeded(history: readonly AcquisitionEvent[]): Promise<FakeEventStore> {
  const store = new FakeEventStore();
  await store.append('acq-1', 0, history, appendMetadata('acq-1', fixedClock()));
  return store;
}

function types(store: FakeEventStore): string[] {
  return store.all().map((entry) => entry.type);
}

describe('deliverDownloadOutcome', () => {
  it('records a completed outcome through the normal decision path', async () => {
    const store = await seeded(startedHistory([candidate]));

    const delivered = await deliverDownloadOutcome(
      consumer(store),
      'acq-1',
      candidate.identity,
      {
        kind: 'completed',
        files: sampleFiles,
      },
      testContext(),
    );

    expect(delivered.isOk()).toBe(true);
    expect(types(store)).toContain('DownloadCompleted');
  });

  it('records a failed outcome as the rejection-and-advance batch', async () => {
    const store = await seeded(startedHistory([candidate, matchingCandidate('b')]));

    const delivered = await deliverDownloadOutcome(
      consumer(store),
      'acq-1',
      candidate.identity,
      {
        kind: 'failed',
        reason: 'Stalled',
        files: sampleFiles,
      },
      testContext(),
    );

    expect(delivered.isOk()).toBe(true);
    expect(types(store)).toEqual(
      expect.arrayContaining(['DownloadFailed', 'CandidateRejected', 'CandidateSelected']),
    );
    const rejected = store.all().find((entry) => entry.type === 'CandidateRejected')?.event as
      Extract<AcquisitionEvent, { type: 'CandidateRejected' }> | undefined;
    expect(rejected?.files).toEqual(sampleFiles); // partial staging threads through for cleanup
  });

  it('absorbs an outcome naming a candidate the ladder already moved past (no wedge)', async () => {
    // The crash-window re-emit: candidate a's outcome was recorded, the process died before the
    // watch was forgotten, and the boot re-derivation delivered it again after b took over.
    const other = matchingCandidate('b');
    const store = await seeded([
      ...startedHistory([candidate, other]),
      { type: 'DownloadFailed', candidate: candidate.identity, reason: 'Stalled' },
      { type: 'CandidateRejected', candidate: candidate.identity },
      { type: 'CandidateSelected', candidate: other },
    ]);
    const before = types(store);

    const delivered = await deliverDownloadOutcome(
      consumer(store),
      'acq-1',
      candidate.identity,
      {
        kind: 'failed',
        reason: 'Stalled',
      },
      testContext(),
    );

    expect(delivered.isOk()).toBe(true); // recorded-and-skipped, not an error to retry
    expect(types(store)).toEqual(before); // nothing appended, nothing mis-attached
  });

  it('records and skips an outcome the decision path rejects as out-of-protocol', async () => {
    // Delivered after the download already settled (phase Validating): decide answers with an
    // IllegalTransition — the consumer records the rejection and resolves, never retrying it.
    const store = await seeded(validatingHistory([candidate]));
    const before = types(store);

    const delivered = await deliverDownloadOutcome(
      consumer(store),
      'acq-1',
      candidate.identity,
      {
        kind: 'completed',
        files: sampleFiles,
      },
      testContext(),
    );

    expect(delivered.isOk()).toBe(true);
    expect(types(store)).toEqual(before);
  });

  it('settles a cancelled in-flight candidate so its staging is cleaned', async () => {
    const store = await seeded([...startedHistory([candidate]), { type: 'AcquisitionCancelled' }]);

    const delivered = await deliverDownloadOutcome(
      consumer(store),
      'acq-1',
      candidate.identity,
      {
        kind: 'failed',
        reason: 'Cancelled',
        files: sampleFiles,
      },
      testContext(),
    );

    expect(delivered.isOk()).toBe(true);
    expect(types(store)).toContain('CandidateRejected');
  });

  it('hands an infrastructure fault back for the supervisor to retry, naming what faulted', async () => {
    const store = await seeded(selectedHistory([candidate]));
    store.failAppends = true;

    const delivered = await deliverDownloadOutcome(
      consumer(store),
      'acq-1',
      candidate.identity,
      {
        kind: 'completed',
        files: sampleFiles,
      },
      testContext(),
    );

    // The store's own fault travels out as itself: re-labelling it with this consumer's name
    // would point the operator at the delivery path instead of at the store that broke.
    expect(delivered._unsafeUnwrapErr()).toMatchObject({
      kind: 'InfraError',
      operation: 'event-store.append',
    });
  });

  it('hands a concurrency conflict back as a retryable fault attributed to the delivery', async () => {
    const store = await seeded(selectedHistory([candidate]));
    store.conflictAppends = true;

    const delivered = await deliverDownloadOutcome(
      consumer(store),
      'acq-1',
      candidate.identity,
      {
        kind: 'completed',
        files: sampleFiles,
      },
      testContext(),
    );

    // A conflict is not an infrastructure error, so it has no operation of its own — the delivery
    // names itself as the place that could not land, and carries the conflict as the reason.
    const error = delivered._unsafeUnwrapErr();
    expect(error).toMatchObject({ kind: 'InfraError', operation: 'download-outcome.deliver' });
    expect(error.message).toContain('ConcurrencyConflict');
  });
});
