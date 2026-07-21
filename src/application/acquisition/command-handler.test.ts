import { describe, expect, it } from 'vitest';
import { applyCommand } from './command-handler.js';
import { FakeEventStore, fixedClock } from '../__fixtures__/fakes.js';
import {
  defaultPolicies,
  resolvedHistory,
  sampleRequest,
} from '../../domain/acquisition/__fixtures__/acquisition-fixtures.js';

const clock = fixedClock();

function deps() {
  return { store: new FakeEventStore(), clock };
}

describe('applyCommand', () => {
  it('appends the events decided for a fresh stream', async () => {
    const d = deps();
    const result = await applyCommand(d, 'acq-1', {
      type: 'SubmitAcquisition',
      request: sampleRequest,
      policies: defaultPolicies(),
    });
    const appended = result._unsafeUnwrap();
    expect(appended.map((entry) => entry.type)).toEqual(['AcquisitionRequested']);
    expect(appended[0]!.metadata.occurredAt).toBe('2026-07-03T12:00:00.000Z');
  });

  it('surfaces a domain error for an illegal command', async () => {
    const d = deps();
    await d.store.append(
      'acq-1',
      0,
      [{ type: 'AcquisitionRequested', request: sampleRequest, policies: defaultPolicies() }],
      { acquisitionId: 'acq-1', occurredAt: clock.now().toISOString() },
    );
    const result = await applyCommand(d, 'acq-1', {
      type: 'RecordDownloadFailed',
      reason: 'Stalled',
    });
    expect(result._unsafeUnwrapErr()).toMatchObject({ kind: 'IllegalTransition' });
  });

  it('appends nothing when decide ignores a stale command', async () => {
    const d = deps();
    await d.store.append('acq-1', 0, [...resolvedHistory(), { type: 'AcquisitionCancelled' }], {
      acquisitionId: 'acq-1',
      occurredAt: clock.now().toISOString(),
    });
    const before = d.store.all().length;
    const result = await applyCommand(d, 'acq-1', { type: 'RecordDownloadCompleted', files: [] });
    expect(result._unsafeUnwrap()).toEqual([]);
    expect(d.store.all().length).toBe(before);
  });

  it('propagates an infrastructure read failure', async () => {
    const d = deps();
    d.store.failReads = true;
    const result = await applyCommand(d, 'acq-1', { type: 'CancelAcquisition' });
    expect(result._unsafeUnwrapErr()).toMatchObject({ kind: 'InfraError' });
  });
});
