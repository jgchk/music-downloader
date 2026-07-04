import { describe, expect, it } from 'vitest';
import {
  cancelAcquisition,
  getAcquisition,
  getAcquisitionProgress,
  listAcquisitions,
  submitAcquisition,
} from './use-cases.js';
import type { UseCaseDeps } from './use-cases.js';
import { FakeEventStore, fixedClock, sequentialIds } from '../__fixtures__/fakes.js';
import { AcquisitionStatusProjection, ProgressReadModel } from '../projections/read-models.js';
import {
  defaultPolicies,
  sampleRequest,
} from '../../domain/acquisition/__fixtures__/acquisition-fixtures.js';

function deps(): UseCaseDeps {
  return {
    store: new FakeEventStore(),
    clock: fixedClock(),
    ids: sequentialIds(),
    status: new AcquisitionStatusProjection(),
    progress: new ProgressReadModel(),
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
});
