import { appendMetadata, fixedCorrelation, testContext } from '../__fixtures__/correlation.js';
import { describe, expect, it } from 'vitest';
import {
  cancelAcquisition,
  getAcquisition,
  getAcquisitionProgress,
  listAcquisitions,
  recordExternalValidationFailure,
  selectEdition,
  submitAcquisition,
} from './use-cases.js';
import type { UseCaseDependencies } from './use-cases.js';
import { FakeEventStore, fixedClock, sequentialIds } from '../__fixtures__/fakes.js';
import { asMbid } from '../../domain/shared/__fixtures__/mbid.js';
import {
  DownloadStatusProjection,
  ProgressReadModel,
  StalledReadModel,
} from '../projections/read-models.js';
import {
  awaitingSelectionHistory,
  defaultPolicies,
  fulfilledHistory,
  matchingCandidate,
  sampleRequest,
} from '../../domain/download/__fixtures__/download-fixtures.js';

function dependencies(): UseCaseDependencies {
  return {
    store: new FakeEventStore(),
    clock: fixedClock(),
    ids: sequentialIds(),
    status: new DownloadStatusProjection(),
    progress: new ProgressReadModel(),
    stalled: new StalledReadModel(),
    correlation: fixedCorrelation(),
  };
}

describe('submitAcquisition', () => {
  it('mints an id and appends the requested event', async () => {
    const d = dependencies();
    const result = await submitAcquisition(
      d,
      {
        request: sampleRequest,
        policies: defaultPolicies(),
      },
      testContext(),
    );
    expect(result._unsafeUnwrap().acquisitionId).toBe('acq-1');
    expect((d.store as FakeEventStore).all().map((event) => event.type)).toEqual([
      'DownloadRequested',
    ]);
  });
});

describe('cancelAcquisition', () => {
  it('appends a cancellation for a live download', async () => {
    const d = dependencies();
    const submitAcquisitionResult = await submitAcquisition(
      d,
      {
        request: sampleRequest,
        policies: defaultPolicies(),
      },
      testContext(),
    );
    const { acquisitionId } = submitAcquisitionResult._unsafeUnwrap();
    const result = await cancelAcquisition(d, acquisitionId, testContext());
    expect(result.isOk()).toBe(true);
    expect((d.store as FakeEventStore).all().map((event) => event.type)).toContain(
      'DownloadCancelled',
    );
  });
});

describe('selectEdition', () => {
  async function awaitingDependencies(): Promise<UseCaseDependencies> {
    const d = dependencies();
    await (d.store as FakeEventStore).append(
      'acq-1',
      0,
      awaitingSelectionHistory(),
      appendMetadata('acq-1', fixedClock()),
    );
    return d;
  }

  it('appends the selection for an download awaiting one', async () => {
    const d = await awaitingDependencies();
    const result = await selectEdition(d, 'acq-1', asMbid('boot-1'), testContext());
    expect(result.isOk()).toBe(true);
    expect((d.store as FakeEventStore).all().map((event) => event.type)).toContain(
      'EditionSelected',
    );
  });

  it('surfaces the modeled rejection for an off-menu edition', async () => {
    const d = await awaitingDependencies();
    const result = await selectEdition(d, 'acq-1', asMbid('not-on-the-menu'), testContext());
    expect(result._unsafeUnwrapErr()).toEqual({
      kind: 'UnknownEdition',
      releaseMbid: 'not-on-the-menu',
    });
    expect((d.store as FakeEventStore).all().map((event) => event.type)).not.toContain(
      'EditionSelected',
    );
  });

  it('surfaces the modeled rejection for an download not awaiting selection', async () => {
    const d = dependencies();
    const submitAcquisitionResult2 = await submitAcquisition(
      d,
      {
        request: sampleRequest,
        policies: defaultPolicies(),
      },
      testContext(),
    );
    const { acquisitionId } = submitAcquisitionResult2._unsafeUnwrap();
    const result = await selectEdition(d, acquisitionId, asMbid('boot-1'), testContext());
    expect(result._unsafeUnwrapErr()).toMatchObject({
      kind: 'IllegalTransition',
      command: 'SelectEdition',
    });
  });
});

describe('recordExternalValidationFailure', () => {
  const a = matchingCandidate('a');
  const b = matchingCandidate('b');

  async function fulfilledDependencies(): Promise<UseCaseDependencies> {
    const d = dependencies();
    await (d.store as FakeEventStore)
      .append('acq-9', 0, fulfilledHistory([a, b]), appendMetadata('acq-9', fixedClock()))
      .unwrapOr([]);
    return d;
  }

  it('revives a fulfilled download whose candidate the verdict names', async () => {
    const d = await fulfilledDependencies();
    const result = await recordExternalValidationFailure(
      d,
      'acq-9',
      {
        candidate: { username: a.identity.username, path: a.identity.path },
        reasons: ['corrupt stub'],
      },
      testContext(),
    );
    expect(result.isOk()).toBe(true);
    expect((d.store as FakeEventStore).all().map((event) => event.type)).toContain(
      'FulfillmentRejected',
    );
  });

  it('converges without error on a stale or unknown verdict', async () => {
    const d = await fulfilledDependencies();
    const before = (d.store as FakeEventStore).all().length;
    const stale = await recordExternalValidationFailure(
      d,
      'acq-9',
      {
        candidate: b.identity,
        reasons: [],
      },
      testContext(),
    );
    const unknown = await recordExternalValidationFailure(
      d,
      'missing',
      {
        candidate: a.identity,
        reasons: [],
      },
      testContext(),
    );
    expect(stale.isOk()).toBe(true);
    expect(unknown.isOk()).toBe(true);
    expect((d.store as FakeEventStore).all()).toHaveLength(before);
  });
});

describe('queries', () => {
  function requested(): ReturnType<typeof dependencies> {
    const d = dependencies();
    d.status.apply({
      globalSeq: 1,
      streamId: 'acq-1',
      version: 0,
      type: 'DownloadRequested',
      event: { type: 'DownloadRequested', request: sampleRequest, policies: defaultPolicies() },
      metadata: appendMetadata('acq-1', fixedClock()),
    });
    return d;
  }

  it('reads the status view of an applied download', () => {
    expect(getAcquisition(requested(), 'acq-1')?.status).toBe('Pending');
  });

  it('reports nothing for an unknown download id', () => {
    expect(getAcquisition(requested(), 'missing')).toBeUndefined();
  });

  it('lists one entry per applied download', () => {
    expect(listAcquisitions(requested())).toHaveLength(1);
  });

  it('reads the latest download progress for an download', () => {
    const d = requested();
    d.progress.update('acq-1', { percent: 10, bytesTransferred: 1, bytesTotal: 10 });
    expect(getAcquisitionProgress(d, 'acq-1')?.percent).toBe(10);
  });

  it('joins the stalled exposure onto get and list, absent by default (reactor-durability D2)', () => {
    const d = dependencies();
    d.status.apply({
      globalSeq: 1,
      streamId: 'acq-1',
      version: 0,
      type: 'DownloadRequested',
      event: { type: 'DownloadRequested', request: sampleRequest, policies: defaultPolicies() },
      metadata: appendMetadata('acq-1', fixedClock()),
    });

    expect(getAcquisition(d, 'acq-1')?.stalled).toBeUndefined();
    expect(listAcquisitions(d)[0]?.stalled).toBeUndefined();

    d.stalled.mark('acq-1');
    expect(getAcquisition(d, 'acq-1')?.stalled).toBe(true);
    expect(listAcquisitions(d)[0]?.stalled).toBe(true);
  });
});
