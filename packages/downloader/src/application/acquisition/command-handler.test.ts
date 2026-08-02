import { describe, expect, it } from 'vitest';
import { applyCommand } from './command-handler.js';
import { FakeEventStore, fixedClock } from '../__fixtures__/fakes.js';
import {
  defaultPolicies,
  matchingCandidate,
  resolvedHistory,
  sampleRequest,
} from '../../domain/acquisition/__fixtures__/acquisition-fixtures.js';

const clock = fixedClock();

function dependencies() {
  return { store: new FakeEventStore(), clock };
}

describe('applyCommand', () => {
  it('appends the events decided for a fresh stream', async () => {
    const d = dependencies();
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
    const d = dependencies();
    await d.store.append(
      'acq-1',
      0,
      [{ type: 'AcquisitionRequested', request: sampleRequest, policies: defaultPolicies() }],
      { acquisitionId: 'acq-1', occurredAt: clock.now().toISOString() },
    );
    const result = await applyCommand(d, 'acq-1', {
      type: 'RecordDownloadFailed',
      reason: 'Stalled',
      candidate: matchingCandidate('a').identity,
    });
    expect(result._unsafeUnwrapErr()).toMatchObject({ kind: 'IllegalTransition' });
  });

  it('appends nothing when decide ignores a stale command', async () => {
    const d = dependencies();
    await d.store.append('acq-1', 0, [...resolvedHistory(), { type: 'AcquisitionCancelled' }], {
      acquisitionId: 'acq-1',
      occurredAt: clock.now().toISOString(),
    });
    const before = d.store.all().length;
    const result = await applyCommand(d, 'acq-1', {
      type: 'RecordDownloadCompleted',
      files: [],
      candidate: matchingCandidate('a').identity,
    });
    expect(result._unsafeUnwrap()).toEqual([]);
    expect(d.store.all().length).toBe(before);
  });

  it('re-decides against the fresh stream when an append loses the optimistic-concurrency race', async () => {
    // A benign race: another writer (the download-outcome consumer, a cancellation) appended
    // between our read and our append. The command re-runs against the fresh stream — decide is
    // the guard — instead of surfacing a retryable fault that would park the stream for nothing.
    const d = dependencies();
    await d.store.append('acq-1', 0, resolvedHistory(), {
      acquisitionId: 'acq-1',
      occurredAt: clock.now().toISOString(),
    });
    d.store.conflictNextAppends = 1;

    const result = await applyCommand(d, 'acq-1', { type: 'RecordSearchResults', candidates: [] });

    expect(result._unsafeUnwrap().map((entry) => entry.type)).toContain('SearchCompleted');
  });

  it('absorbs up to two lost races and surfaces the third (the retry bound)', async () => {
    const d = dependencies();
    await d.store.append('acq-1', 0, resolvedHistory(), {
      acquisitionId: 'acq-1',
      occurredAt: clock.now().toISOString(),
    });

    d.store.conflictNextAppends = 2; // attempts 1–2 lose, attempt 3 lands
    const landed = await applyCommand(d, 'acq-1', { type: 'RecordSearchResults', candidates: [] });
    expect(landed.isOk()).toBe(true);

    const d2 = dependencies();
    await d2.store.append('acq-1', 0, resolvedHistory(), {
      acquisitionId: 'acq-1',
      occurredAt: clock.now().toISOString(),
    });
    d2.store.conflictNextAppends = 3; // every attempt loses — the bound surfaces the conflict
    const exhausted = await applyCommand(d2, 'acq-1', {
      type: 'RecordSearchResults',
      candidates: [],
    });
    expect(exhausted._unsafeUnwrapErr()).toMatchObject({ kind: 'ConcurrencyConflict' });
  });

  it('surfaces persistent append contention as the retryable conflict it is', async () => {
    const d = dependencies();
    await d.store.append('acq-1', 0, resolvedHistory(), {
      acquisitionId: 'acq-1',
      occurredAt: clock.now().toISOString(),
    });
    d.store.conflictAppends = true;

    const result = await applyCommand(d, 'acq-1', { type: 'RecordSearchResults', candidates: [] });

    expect(result._unsafeUnwrapErr()).toMatchObject({ kind: 'ConcurrencyConflict' });
  });

  it('propagates an infrastructure read failure', async () => {
    const d = dependencies();
    d.store.failReads = true;
    const result = await applyCommand(d, 'acq-1', { type: 'CancelAcquisition' });
    expect(result._unsafeUnwrapErr()).toMatchObject({ kind: 'InfraError' });
  });
});
