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
import type { UseCaseDeps } from './use-cases.js';
import { FakeEventStore, fixedClock, sequentialIds } from '../__fixtures__/fakes.js';
import { asMbid } from '../../domain/shared/__fixtures__/mbid.js';
import {
  AcquisitionStatusProjection,
  ProgressReadModel,
  StalledReadModel,
} from '../projections/read-models.js';
import {
  awaitingSelectionHistory,
  defaultPolicies,
  fulfilledHistory,
  matchingCandidate,
  sampleRequest,
} from '../../domain/acquisition/__fixtures__/acquisition-fixtures.js';

function deps(): UseCaseDeps {
  return {
    store: new FakeEventStore(),
    clock: fixedClock(),
    ids: sequentialIds(),
    status: new AcquisitionStatusProjection(),
    progress: new ProgressReadModel(),
    stalled: new StalledReadModel(),
  };
}

describe('submitAcquisition', () => {
  it('mints an id and appends the requested event', async () => {
    const d = deps();
    const result = await submitAcquisition(d, {
      request: sampleRequest,
      policies: defaultPolicies(),
    });
    expect(result._unsafeUnwrap().acquisitionId).toBe('acq-1');
    expect((d.store as FakeEventStore).all().map((e) => e.type)).toEqual(['AcquisitionRequested']);
  });
});

describe('cancelAcquisition', () => {
  it('appends a cancellation for a live acquisition', async () => {
    const d = deps();
    const { acquisitionId } = (
      await submitAcquisition(d, { request: sampleRequest, policies: defaultPolicies() })
    )._unsafeUnwrap();
    const result = await cancelAcquisition(d, acquisitionId);
    expect(result.isOk()).toBe(true);
    expect((d.store as FakeEventStore).all().map((e) => e.type)).toContain('AcquisitionCancelled');
  });
});

describe('selectEdition', () => {
  async function awaitingDeps(): Promise<UseCaseDeps> {
    const d = deps();
    await (d.store as FakeEventStore).append('acq-1', 0, awaitingSelectionHistory(), {
      acquisitionId: 'acq-1',
      occurredAt: 't',
    });
    return d;
  }

  it('appends the selection for an acquisition awaiting one', async () => {
    const d = await awaitingDeps();
    const result = await selectEdition(d, 'acq-1', asMbid('boot-1'));
    expect(result.isOk()).toBe(true);
    expect((d.store as FakeEventStore).all().map((e) => e.type)).toContain('EditionSelected');
  });

  it('surfaces the modeled rejection for an off-menu edition', async () => {
    const d = await awaitingDeps();
    const result = await selectEdition(d, 'acq-1', asMbid('not-on-the-menu'));
    expect(result._unsafeUnwrapErr()).toEqual({
      kind: 'UnknownEdition',
      releaseMbid: 'not-on-the-menu',
    });
    expect((d.store as FakeEventStore).all().map((e) => e.type)).not.toContain('EditionSelected');
  });

  it('surfaces the modeled rejection for an acquisition not awaiting selection', async () => {
    const d = deps();
    const { acquisitionId } = (
      await submitAcquisition(d, { request: sampleRequest, policies: defaultPolicies() })
    )._unsafeUnwrap();
    const result = await selectEdition(d, acquisitionId, asMbid('boot-1'));
    expect(result._unsafeUnwrapErr()).toMatchObject({
      kind: 'IllegalTransition',
      command: 'SelectEdition',
    });
  });
});

describe('recordExternalValidationFailure', () => {
  const a = matchingCandidate('a');
  const b = matchingCandidate('b');

  async function fulfilledDeps(): Promise<UseCaseDeps> {
    const d = deps();
    await (d.store as FakeEventStore)
      .append('acq-9', 0, fulfilledHistory([a, b]), { acquisitionId: 'acq-9', occurredAt: 't' })
      .unwrapOr([]);
    return d;
  }

  it('revives a fulfilled acquisition whose candidate the verdict names', async () => {
    const d = await fulfilledDeps();
    const result = await recordExternalValidationFailure(d, 'acq-9', {
      candidate: { username: a.identity.username, path: a.identity.path },
      reasons: ['corrupt stub'],
    });
    expect(result.isOk()).toBe(true);
    expect((d.store as FakeEventStore).all().map((e) => e.type)).toContain('FulfillmentRejected');
  });

  it('converges without error on a stale or unknown verdict', async () => {
    const d = await fulfilledDeps();
    const before = (d.store as FakeEventStore).all().length;
    const stale = await recordExternalValidationFailure(d, 'acq-9', {
      candidate: b.identity,
      reasons: [],
    });
    const unknown = await recordExternalValidationFailure(d, 'missing', {
      candidate: a.identity,
      reasons: [],
    });
    expect(stale.isOk()).toBe(true);
    expect(unknown.isOk()).toBe(true);
    expect((d.store as FakeEventStore).all()).toHaveLength(before);
  });
});

describe('queries', () => {
  it('read status, list, and progress from the projections', () => {
    const d = deps();
    d.status.apply({
      globalSeq: 1,
      streamId: 'acq-1',
      version: 0,
      type: 'AcquisitionRequested',
      event: { type: 'AcquisitionRequested', request: sampleRequest, policies: defaultPolicies() },
      metadata: { acquisitionId: 'acq-1', occurredAt: 't' },
    });
    d.progress.update('acq-1', { percent: 10, bytesTransferred: 1, bytesTotal: 10 });

    expect(getAcquisition(d, 'acq-1')?.status).toBe('Pending');
    expect(getAcquisition(d, 'missing')).toBeUndefined();
    expect(listAcquisitions(d)).toHaveLength(1);
    expect(getAcquisitionProgress(d, 'acq-1')?.percent).toBe(10);
  });

  it('joins the stalled exposure onto get and list, absent by default (reactor-durability D2)', () => {
    const d = deps();
    d.status.apply({
      globalSeq: 1,
      streamId: 'acq-1',
      version: 0,
      type: 'AcquisitionRequested',
      event: { type: 'AcquisitionRequested', request: sampleRequest, policies: defaultPolicies() },
      metadata: { acquisitionId: 'acq-1', occurredAt: 't' },
    });

    expect(getAcquisition(d, 'acq-1')?.stalled).toBeUndefined();
    expect(listAcquisitions(d)[0]?.stalled).toBeUndefined();

    d.stalled.mark('acq-1');
    expect(getAcquisition(d, 'acq-1')?.stalled).toBe(true);
    expect(listAcquisitions(d)[0]?.stalled).toBe(true);
  });
});
