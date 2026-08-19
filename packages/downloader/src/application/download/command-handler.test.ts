import { errAsync } from 'neverthrow';
import { describe, expect, it } from 'vitest';
import { applyCommand } from './command-handler.js';
import { FakeEventStore, fixedClock } from '../__fixtures__/fakes.js';
import { OTHER_STORY, STORY, appendMetadata, testContext } from '../__fixtures__/correlation.js';
import { infraError } from '../ports/errors.js';
import type { EventStorePort } from '../ports/event-store-port.js';
import {
  defaultPolicies,
  matchingCandidate,
  resolvedHistory,
  sampleRequest,
} from '../../domain/download/__fixtures__/download-fixtures.js';

const clock = fixedClock();

function dependencies() {
  return { store: new FakeEventStore(), clock };
}

describe('applyCommand correlation metadata', () => {
  it('writes the operation context into the metadata of the events it appends', async () => {
    const d = dependencies();

    const result = await applyCommand(
      d,
      'acq-1',
      { type: 'SubmitAcquisition', request: sampleRequest, policies: defaultPolicies() },
      testContext(),
    );

    expect(result._unsafeUnwrap()[0]!.metadata).toMatchObject({
      correlationId: STORY,
      causation: { kind: 'command', commandId: 'command-1' },
    });
  });

  it('gives every event of one decision the same causation — the deciding command is their parent', async () => {
    const d = dependencies();
    await d.store.append('acq-1', 0, resolvedHistory(), appendMetadata('acq-1', clock));

    const result = await applyCommand(
      d,
      'acq-1',
      { type: 'CancelAcquisition' },
      testContext(OTHER_STORY),
    );

    const appended = result._unsafeUnwrap();
    expect(appended.length).toBeGreaterThan(0);
    for (const entry of appended) {
      expect(entry.metadata.correlationId).toBe(OTHER_STORY);
      expect(entry.metadata.causation).toEqual({ kind: 'command', commandId: 'command-1' });
    }
  });

  it('carries the context through a re-decide after a lost optimistic-concurrency race', async () => {
    const d = dependencies();
    await d.store.append('acq-1', 0, resolvedHistory(), appendMetadata('acq-1', clock));
    d.store.conflictNextAppends = 1;

    const result = await applyCommand(
      d,
      'acq-1',
      { type: 'RecordSearchResults', candidates: [] },
      testContext(),
    );

    expect(result._unsafeUnwrap()[0]!.metadata.correlationId).toBe(STORY);
  });
});

describe('applyCommand', () => {
  it('appends the events decided for a fresh stream', async () => {
    const d = dependencies();
    const result = await applyCommand(
      d,
      'acq-1',
      { type: 'SubmitAcquisition', request: sampleRequest, policies: defaultPolicies() },
      testContext(),
    );
    const appended = result._unsafeUnwrap();
    expect(appended.map((entry) => entry.type)).toEqual(['DownloadRequested']);
    expect(appended[0]!.metadata.occurredAt).toBe('2026-07-03T12:00:00.000Z');
  });

  it('surfaces a domain error for an illegal command', async () => {
    const d = dependencies();
    await d.store.append(
      'acq-1',
      0,
      [{ type: 'DownloadRequested', request: sampleRequest, policies: defaultPolicies() }],
      appendMetadata('acq-1', clock),
    );
    const result = await applyCommand(
      d,
      'acq-1',
      {
        type: 'RecordDownloadFailed',
        reason: 'Stalled',
        candidate: matchingCandidate('a').identity,
      },
      testContext(),
    );
    expect(result._unsafeUnwrapErr()).toMatchObject({ kind: 'IllegalTransition' });
  });

  it('appends nothing when decide ignores a stale command', async () => {
    const d = dependencies();
    await d.store.append(
      'acq-1',
      0,
      [...resolvedHistory(), { type: 'DownloadCancelled' }],
      appendMetadata('acq-1', clock),
    );
    const before = d.store.all().length;
    const result = await applyCommand(
      d,
      'acq-1',
      { type: 'RecordDownloadCompleted', files: [], candidate: matchingCandidate('a').identity },
      testContext(),
    );
    expect(result._unsafeUnwrap()).toEqual([]);
    expect(d.store.all()).toHaveLength(before);
  });

  it('re-decides against the fresh stream when an append loses the optimistic-concurrency race', async () => {
    // A benign race: another writer (the download-outcome consumer, a cancellation) appended
    // between our read and our append. The command re-runs against the fresh stream — decide is
    // the guard — instead of surfacing a retryable fault that would park the stream for nothing.
    const d = dependencies();
    await d.store.append('acq-1', 0, resolvedHistory(), appendMetadata('acq-1', clock));
    d.store.conflictNextAppends = 1;

    const result = await applyCommand(
      d,
      'acq-1',
      { type: 'RecordSearchResults', candidates: [] },
      testContext(),
    );

    expect(result._unsafeUnwrap().map((entry) => entry.type)).toContain('SearchCompleted');
  });

  it('absorbs up to two lost races within the retry bound', async () => {
    const d = dependencies();
    await d.store.append('acq-1', 0, resolvedHistory(), appendMetadata('acq-1', clock));
    d.store.conflictNextAppends = 2; // attempts 1–2 lose, attempt 3 lands

    const landed = await applyCommand(
      d,
      'acq-1',
      { type: 'RecordSearchResults', candidates: [] },
      testContext(),
    );

    expect(landed._unsafeUnwrap().map((entry) => entry.type)).toContain('SearchCompleted');
  });

  it('surfaces the conflict once every bounded attempt has lost', async () => {
    const d = dependencies();
    await d.store.append('acq-1', 0, resolvedHistory(), appendMetadata('acq-1', clock));
    d.store.conflictNextAppends = 3; // every attempt loses — the bound surfaces the conflict

    const exhausted = await applyCommand(
      d,
      'acq-1',
      { type: 'RecordSearchResults', candidates: [] },
      testContext(),
    );

    expect(exhausted._unsafeUnwrapErr()).toMatchObject({ kind: 'ConcurrencyConflict' });
  });

  it('surfaces persistent append contention as the retryable conflict it is', async () => {
    const d = dependencies();
    await d.store.append('acq-1', 0, resolvedHistory(), appendMetadata('acq-1', clock));
    d.store.conflictAppends = true;

    const result = await applyCommand(
      d,
      'acq-1',
      { type: 'RecordSearchResults', candidates: [] },
      testContext(),
    );

    expect(result._unsafeUnwrapErr()).toMatchObject({ kind: 'ConcurrencyConflict' });
  });

  it('hands an infrastructure append fault straight back instead of re-deciding it', async () => {
    // Only a lost optimistic-concurrency race earns a re-decide — the loser's stale guards absorb
    // it. An infra fault is nobody's race: retrying it here would hide a broken store behind a
    // silent success and take the decision away from the caller that owns the retry cadence.
    const d = dependencies();
    await d.store.append('acq-1', 0, resolvedHistory(), appendMetadata('acq-1', clock));
    let faultsLeft = 1; // a store that faults once and then accepts — an in-place retry would land
    const flakyStore: EventStorePort = {
      readStream: (id) => d.store.readStream(id),
      readAll: (from, limit) => d.store.readAll(from, limit),
      append: (id, version, events, metadata) => {
        if (faultsLeft > 0) {
          faultsLeft -= 1;
          return errAsync(infraError('event-store.append', 'boom'));
        }
        return d.store.append(id, version, events, metadata);
      },
    };

    const result = await applyCommand(
      { store: flakyStore, clock },
      'acq-1',
      { type: 'RecordSearchResults', candidates: [] },
      testContext(),
    );

    expect(result._unsafeUnwrapErr()).toMatchObject({ kind: 'InfraError' });
  });

  it('absorbs a stale command without entering the write path at all', async () => {
    // `decide` answered with no events, so there is nothing to write. The command resolves without
    // an append — not with an append of nothing — which is why a store whose write path is faulted
    // still reports success here: a stale outcome must never look like an infrastructure failure.
    const d = dependencies();
    await d.store.append(
      'acq-1',
      0,
      [...resolvedHistory(), { type: 'DownloadCancelled' }],
      appendMetadata('acq-1', clock),
    );
    d.store.failAppends = true;

    const result = await applyCommand(
      d,
      'acq-1',
      {
        type: 'RecordDownloadCompleted',
        files: [],
        candidate: matchingCandidate('a').identity,
      },
      testContext(),
    );

    expect(result._unsafeUnwrap()).toEqual([]);
  });

  it('propagates an infrastructure read failure', async () => {
    const d = dependencies();
    d.store.failReads = true;
    const result = await applyCommand(d, 'acq-1', { type: 'CancelAcquisition' }, testContext());
    expect(result._unsafeUnwrapErr()).toMatchObject({ kind: 'InfraError' });
  });
});
