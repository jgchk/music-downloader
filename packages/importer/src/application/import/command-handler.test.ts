import { describe, expect, it } from 'vitest';
import {
  DIRECTORY,
  POLICY,
  awaitingMatchReview,
} from '../../domain/import/__fixtures__/import-fixtures.js';
import { FakeEventStore, fixedClock } from '../__fixtures__/fakes.js';
import { OTHER_STORY, STORY, appendMetadata, testContext } from '../__fixtures__/correlation.js';
import { applyCommand } from './command-handler.js';

const clock = fixedClock();

function dependencies() {
  return { store: new FakeEventStore(), clock };
}

describe('applyCommand', () => {
  it('appends the events decided for a fresh stream, stamped with metadata', async () => {
    const d = dependencies();
    const result = await applyCommand(
      d,
      'imp-1',
      {
        type: 'SubmitImport',
        directory: DIRECTORY,
        policy: POLICY,
      },
      testContext(),
    );
    const appended = result._unsafeUnwrap();
    expect(appended.map((entry) => entry.type)).toEqual(['ImportRequested']);
    expect(appended[0]!.metadata).toEqual(appendMetadata('imp-1', fixedClock()));
  });

  it('surfaces a domain error for a protocol violation', async () => {
    const d = dependencies();
    const result = await applyCommand(
      d,
      'imp-1',
      {
        type: 'ResolveReview',
        resolution: { kind: 'import-as-is' },
      },
      testContext(),
    );
    expect(result._unsafeUnwrapErr()).toEqual({ kind: 'UnknownImport' });
  });

  it('appends nothing when decide ignores a stale command', async () => {
    const d = dependencies();
    await d.store.append('imp-1', 0, awaitingMatchReview(), appendMetadata('imp-1', fixedClock()));
    const before = d.store.all().length;
    // Any append at all would come back a conflict here, so an Ok is proof the write path was
    // never entered: a command the decider ignores must not be able to fail on a write it never
    // makes — a redelivered duplicate has to stay answerable while another writer holds the stream.
    d.store.conflictOnAppend = true;
    const result = await applyCommand(
      d,
      'imp-1',
      {
        type: 'RecordApplied',
        location: '/library/x',
        failures: [],
      },
      testContext(),
    );
    expect(result._unsafeUnwrap()).toEqual([]);
    expect(d.store.all()).toHaveLength(before);
  });

  it('propagates an infrastructure read failure', async () => {
    const d = dependencies();
    d.store.failReads = true;
    const result = await applyCommand(
      d,
      'imp-1',
      {
        type: 'SubmitImport',
        directory: DIRECTORY,
        policy: POLICY,
      },
      testContext(),
    );
    expect(result._unsafeUnwrapErr()).toMatchObject({ kind: 'InfraError' });
  });
});

describe('applyCommand correlation metadata', () => {
  it('writes the operation context into the metadata of the events it appends', async () => {
    const d = dependencies();

    const result = await applyCommand(
      d,
      'imp-1',
      { type: 'SubmitImport', directory: DIRECTORY, policy: POLICY },
      testContext(),
    );

    expect(result._unsafeUnwrap()[0]!.metadata).toMatchObject({
      correlationId: STORY,
      causation: { kind: 'command', commandId: 'command-1' },
    });
  });

  it('gives every event of one decision the same causation — the deciding command is their parent', async () => {
    const d = dependencies();
    await d.store.append('imp-1', 0, awaitingMatchReview(), appendMetadata('imp-1', clock));

    const result = await applyCommand(
      d,
      'imp-1',
      { type: 'ResolveReview', resolution: { kind: 'reject', reason: 'unusable-delivery' } },
      testContext(OTHER_STORY),
    );

    const appended = result._unsafeUnwrap();
    expect(appended.length).toBeGreaterThan(0);
    for (const entry of appended) {
      expect(entry.metadata.correlationId).toBe(OTHER_STORY);
      expect(entry.metadata.causation).toEqual({ kind: 'command', commandId: 'command-1' });
    }
  });
});
