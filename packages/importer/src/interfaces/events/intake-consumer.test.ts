import { describe, expect, it } from 'vitest';
import type { SeamEvent } from '../../application/events/catch-up-subscription.js';
import { testWiring } from '../../facade/__fixtures__/wiring.js';
import type { TestWiring } from '../../facade/__fixtures__/wiring.js';
import { intakeEventConsumer } from './intake-consumer.js';
import type { IntakeConsumerOptions } from './intake-consumer.js';

const SOURCE_ROOT = '/downloads/import';
const INTAKE_ROOT = '/music/intake';

function fulfilledEvent(overrides: Partial<Record<string, unknown>> = {}): SeamEvent {
  return {
    globalSeq: 1,
    type: (overrides['type'] as string | undefined) ?? 'acquisition.fulfilled',
    timestamp: '2026-07-18T12:00:00.000Z',
    data: {
      acquisitionId: 'acq-1',
      target: {
        type: 'album',
        artist: 'Radiohead',
        title: 'Kid A',
        musicbrainzReleaseId: 'mb-release-1',
        year: 2000, // unknown fields are ignored — tolerant reader
        trackCount: 2,
      },
      candidate: { username: 'peer1', path: 'peer1/x', sizeBytes: 1000 },
      location: `${SOURCE_ROOT}/Radiohead - Kid A`,
      files: [],
      ...overrides,
    },
  };
}

function consumer(
  wiring: TestWiring,
  overrides: Partial<IntakeConsumerOptions> = {},
): ReturnType<typeof intakeEventConsumer> {
  return intakeEventConsumer(wiring.deps, {
    sourceRoot: SOURCE_ROOT,
    intakeRoot: INTAKE_ROOT,
    directoryExists: () => Promise.resolve(true),
    ...overrides,
  });
}

describe('the intake event consumer', () => {
  it('submits an import for the re-rooted directory with the event hints and provenance', async () => {
    const wiring = testWiring();
    const consume = consumer(wiring);

    const outcome = await consume(fulfilledEvent());

    expect(outcome.isOk()).toBe(true);
    const events = wiring.store.all();
    expect(events[0]?.type).toBe('ImportRequested');
    expect(events[0]?.event).toMatchObject({
      directory: `${INTAKE_ROOT}/Radiohead - Kid A`,
      hints: { mbReleaseId: 'mb-release-1', artist: 'Radiohead', album: 'Kid A' },
      source: {
        acquisitionId: 'acq-1',
        candidate: { username: 'peer1', path: 'peer1/x', sizeBytes: 1000 },
      },
    });
  });

  it('a candidate-less delivery still imports, without retained provenance detail', async () => {
    const wiring = testWiring();
    const consume = consumer(wiring);

    const outcome = await consume(fulfilledEvent({ candidate: undefined }));

    expect(outcome.isOk()).toBe(true);
    expect(wiring.store.all()[0]?.type).toBe('ImportRequested');
  });

  it('acknowledges and ignores events of other types', async () => {
    const wiring = testWiring();
    const consume = consumer(wiring);

    const outcome = await consume(fulfilledEvent({ type: 'acquisition.progressed' }));

    expect(outcome.isOk()).toBe(true);
    expect(wiring.store.all()).toHaveLength(0);
  });

  it('a redelivered acquisition converges without a duplicate import', async () => {
    const wiring = testWiring();
    const consume = consumer(wiring);
    await consume(fulfilledEvent());
    wiring.sync();
    const before = wiring.store.all().length;

    const again = await consume(fulfilledEvent());

    expect(again.isOk()).toBe(true);
    expect(wiring.store.all()).toHaveLength(before);
  });

  it('a malformed payload of the known type is a permanent (poison) failure', async () => {
    const wiring = testWiring();
    const consume = consumer(wiring);

    const outcome = await consume(fulfilledEvent({ location: '' }));

    expect(outcome._unsafeUnwrapErr()).toEqual({ kind: 'Permanent', reason: 'InvalidPayload' });
  });

  it('a location outside the source root is a permanent rejection', async () => {
    const wiring = testWiring();
    const consume = consumer(wiring);

    const outcome = await consume(fulfilledEvent({ location: '/elsewhere/Radiohead - Kid A' }));

    expect(outcome._unsafeUnwrapErr()).toEqual({ kind: 'Permanent', reason: 'OutsideSourceRoot' });
    expect(wiring.store.all()).toHaveLength(0);
  });

  it('a not-yet-visible directory is transient so the seam redelivers', async () => {
    const wiring = testWiring();
    const consume = consumer(wiring, { directoryExists: () => Promise.resolve(false) });

    const outcome = await consume(fulfilledEvent());

    expect(outcome._unsafeUnwrapErr()).toEqual({
      kind: 'Transient',
      reason: 'IntakeDirectoryMissing',
    });
    expect(wiring.store.all()).toHaveLength(0);
  });

  it('a faulting directory probe is a distinct transient fault, not "missing"', async () => {
    const wiring = testWiring();
    const consume = consumer(wiring, {
      directoryExists: () => Promise.reject(new Error('EACCES: permission denied')),
    });

    const outcome = await consume(fulfilledEvent());

    // A probe that throws (EACCES/EIO/…) must not masquerade as IntakeDirectoryMissing — it is
    // held under its own reason so a genuine infra fault is distinguishable in the logs.
    expect(outcome._unsafeUnwrapErr()).toEqual({ kind: 'Transient', reason: 'IntakeProbeFailed' });
    expect(wiring.store.all()).toHaveLength(0);
  });

  it('an append fault is transient, passing the append error kind through as the hold reason', async () => {
    const wiring = testWiring();
    wiring.store.failAppends = true;
    const consume = consumer(wiring);

    const outcome = await consume(fulfilledEvent());

    // The submission's sad path is an infra fault; its kind rides through as the transient reason.
    expect(outcome._unsafeUnwrapErr()).toEqual({ kind: 'Transient', reason: 'InfraError' });
  });

  it('an append race is transient too, passing the conflict kind through as the hold reason', async () => {
    const wiring = testWiring();
    wiring.store.conflictOnAppend = true;
    const consume = consumer(wiring);

    const outcome = await consume(fulfilledEvent());

    expect(outcome._unsafeUnwrapErr()).toEqual({
      kind: 'Transient',
      reason: 'ConcurrencyConflict',
    });
  });
});
